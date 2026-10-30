/*
 * bsc.cpp - the C++ shim for the Battleships Championship platform (protocol: docs/protocol-v1.md).
 *
 * It owns main(), connects over plain ws:// (no TLS: the admin must allow ws:// for the account),
 * and turns protocol frames into calls of the four on_* functions of bot.cpp. Students do not edit it.
 *
 * Layers, bottom up: sockets -> WebSocket client -> JSON tokenizer -> protocol -> main loop.
 *
 * Constraints: C++98, standard library only (stdio/stdlib/string/time), no threads, no allocation.
 * On Windows ws2_32.dll is loaded at run time, so the project needs no extra linker setting.
 * The server's Sec-WebSocket-Accept is not verified (it needs SHA-1 and buys nothing without TLS).
 */
#include "bsc.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifdef _WIN32
#include <winsock2.h>
#include <windows.h>
#else
#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#endif

/* ================================================================================================
 * Public globals (declared in bsc.h)
 * ============================================================================================== */

int my_seat;
char ruleset_id[48];
int board_w, board_h;
int num_ships;
int fleet[MAX_SHIPS];
int rule_touching_allowed, rule_extra_turn_on_hit, rule_announce_sunk;
int rule_repeat_wastes_turn, rule_reveal_on_game_over;
int limit_place_ms, limit_move_ms, limit_max_strikes;

int game_index, game_total, i_move_first;
char opponent_name[64];
char opponent_program[64];
int deadline_ms;
int strikes;
char last_error[64];

char my_board[MAX_BOARD][MAX_BOARD + 1];
char enemy_board[MAX_BOARD][MAX_BOARD + 1];
int last_shot_x, last_shot_y;
char last_shot_result;
int last_shot_len;
int incoming_count;
int incoming_x[MAX_SHOTS], incoming_y[MAX_SHOTS];
char incoming_result[MAX_SHOTS];
int enemy_remaining_count;
int enemy_remaining[MAX_SHIPS];

int i_won;
char game_over_reason[16];
int score_me, score_opponent, series_done;
int reveal_available;
int opp_ship_count;
int opp_ship_len[MAX_SHIPS], opp_ship_x[MAX_SHIPS], opp_ship_y[MAX_SHIPS];
char opp_ship_dir[MAX_SHIPS];
int opp_shot_count;
int opp_shot_x[MAX_SHOTS], opp_shot_y[MAX_SHOTS];
char opp_shot_result[MAX_SHOTS];

char reset_reason[24];

/* ================================================================================================
 * Small helpers
 * ============================================================================================== */

static void copy_str(char *dst, int cap, const char *src) {
    int i = 0;
    while (src[i] != 0 && i < cap - 1) {
        dst[i] = src[i];
        i++;
    }
    dst[i] = 0;
}

static void say(const char *text) {
    printf("[bsc] %s\n", text);
}

/* xorshift: WebSocket masks and keys must not disturb the student's rand() sequence. */
static unsigned long g_rs = 2463534242UL;
static unsigned long rnd32() {
    g_rs ^= (g_rs << 13) & 0xFFFFFFFFUL;
    g_rs ^= (g_rs >> 17);
    g_rs ^= (g_rs << 5) & 0xFFFFFFFFUL;
    g_rs &= 0xFFFFFFFFUL;
    return g_rs;
}

static void sleep_ms(int ms) {
#ifdef _WIN32
    Sleep((DWORD)ms);
#else
    struct timespec t;
    t.tv_sec = ms / 1000;
    t.tv_nsec = (long)(ms % 1000) * 1000000L;
    nanosleep(&t, NULL);
#endif
}

/* ================================================================================================
 * Layer 1: sockets (Winsock functions are looked up by name, so no -lws2_32 is needed)
 * ============================================================================================== */

#ifdef _WIN32
typedef SOCKET sock_t;
static sock_t g_sock = INVALID_SOCKET;
#define NO_SOCK INVALID_SOCKET

typedef int(WSAAPI *fn_startup)(WORD, LPWSADATA);
typedef SOCKET(WSAAPI *fn_socket)(int, int, int);
typedef int(WSAAPI *fn_connect)(SOCKET, const struct sockaddr *, int);
typedef int(WSAAPI *fn_send)(SOCKET, const char *, int, int);
typedef int(WSAAPI *fn_recv)(SOCKET, char *, int, int);
typedef int(WSAAPI *fn_close)(SOCKET);
typedef int(WSAAPI *fn_setopt)(SOCKET, int, int, const char *, int);
typedef struct hostent *(WSAAPI *fn_byname)(const char *);

static fn_socket w_socket;
static fn_connect w_connect;
static fn_send w_send;
static fn_recv w_recv;
static fn_close w_close;
static fn_setopt w_setopt;
static fn_byname w_byname;

static int net_init() {
    static int done = 0;
    HMODULE lib;
    fn_startup startup;
    WSADATA data;
    if (done) return 0;
    lib = LoadLibraryA("ws2_32.dll");
    if (lib == NULL) return -1;
    startup = (fn_startup)GetProcAddress(lib, "WSAStartup");
    w_socket = (fn_socket)GetProcAddress(lib, "socket");
    w_connect = (fn_connect)GetProcAddress(lib, "connect");
    w_send = (fn_send)GetProcAddress(lib, "send");
    w_recv = (fn_recv)GetProcAddress(lib, "recv");
    w_close = (fn_close)GetProcAddress(lib, "closesocket");
    w_setopt = (fn_setopt)GetProcAddress(lib, "setsockopt");
    w_byname = (fn_byname)GetProcAddress(lib, "gethostbyname");
    if (!startup || !w_socket || !w_connect || !w_send || !w_recv || !w_close || !w_setopt || !w_byname) return -1;
    if (startup(MAKEWORD(2, 2), &data) != 0) return -1;
    done = 1;
    return 0;
}
#define N_SOCKET w_socket
#define N_CONNECT w_connect
#define N_SEND w_send
#define N_RECV w_recv
#define N_CLOSE w_close
#define N_BYNAME w_byname
#else
typedef int sock_t;
static sock_t g_sock = -1;
#define NO_SOCK (-1)
static int net_init() {
    signal(SIGPIPE, SIG_IGN); /* writing to a closed socket must return an error, not kill us */
    return 0;
}
#define N_SOCKET socket
#define N_CONNECT connect
#define N_SEND send
#define N_RECV recv
#define N_CLOSE close
#define N_BYNAME gethostbyname
#endif

static void net_close() {
    if (g_sock != NO_SOCK) N_CLOSE(g_sock);
    g_sock = NO_SOCK;
}

/* The port in network byte order, whatever the machine's own order is. */
static unsigned short net16(int port) {
    unsigned char b[2];
    unsigned short r;
    b[0] = (unsigned char)((port >> 8) & 255);
    b[1] = (unsigned char)(port & 255);
    memcpy(&r, b, 2);
    return r;
}

/* The server pings every 15 s, so a minute of silence means the connection is dead. */
#define RECV_TIMEOUT_MS 60000

static int net_connect(const char *host, int port) {
    struct hostent *he;
    struct sockaddr_in addr;
    if (net_init() != 0) return -1;
    he = N_BYNAME(host);
    if (he == NULL || he->h_addrtype != AF_INET || he->h_addr_list[0] == NULL) return -1;
    g_sock = N_SOCKET(AF_INET, SOCK_STREAM, 0);
    if (g_sock == NO_SOCK) return -1;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_port = net16(port);
    memcpy(&addr.sin_addr, he->h_addr_list[0], 4);
    if (N_CONNECT(g_sock, (const struct sockaddr *)&addr, sizeof addr) != 0) {
        net_close();
        return -1;
    }
#ifdef _WIN32
    {
        DWORD ms = RECV_TIMEOUT_MS;
        w_setopt(g_sock, SOL_SOCKET, SO_RCVTIMEO, (const char *)&ms, sizeof ms);
    }
#else
    {
        struct timeval tv;
        tv.tv_sec = RECV_TIMEOUT_MS / 1000;
        tv.tv_usec = 0;
        setsockopt(g_sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    }
#endif
    return 0;
}

static int net_write(const unsigned char *data, int n) {
    while (n > 0) {
        int r = (int)N_SEND(g_sock, (const char *)data, n, 0);
#ifndef _WIN32
        if (r < 0 && errno == EINTR) continue;
#endif
        if (r <= 0) return -1;
        data += r;
        n -= r;
    }
    return 0;
}

static int net_read(unsigned char *buf, int cap) {
    for (;;) {
        int r = (int)N_RECV(g_sock, (char *)buf, cap, 0);
#ifndef _WIN32
        if (r < 0 && errno == EINTR) continue;
#endif
        return r;
    }
}

/* Buffered exact reads. */
static unsigned char g_ib[4096];
static int g_ipos, g_ilen;

static int rd(unsigned char *dst, int n) {
    while (n > 0) {
        int c;
        if (g_ipos == g_ilen) {
            int r = net_read(g_ib, (int)sizeof g_ib);
            if (r <= 0) return -1;
            g_ipos = 0;
            g_ilen = r;
        }
        c = g_ilen - g_ipos;
        if (c > n) c = n;
        memcpy(dst, g_ib + g_ipos, (size_t)c);
        g_ipos += c;
        dst += c;
        n -= c;
    }
    return 0;
}

/* ================================================================================================
 * Layer 2: WebSocket client (RFC 6455, text frames only)
 * ============================================================================================== */

#define MSG_CAP 65536

static char g_msg[MSG_CAP + 1];
static int g_close_code; /* from the server's close frame; 0 if the connection simply dropped */
static char g_close_reason[128];

static void base64_16(const unsigned char *in, char *out) {
    static const char *abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int i, o = 0;
    for (i = 0; i < 15; i += 3) {
        unsigned long v = ((unsigned long)in[i] << 16) | ((unsigned long)in[i + 1] << 8) | in[i + 2];
        out[o++] = abc[(v >> 18) & 63];
        out[o++] = abc[(v >> 12) & 63];
        out[o++] = abc[(v >> 6) & 63];
        out[o++] = abc[v & 63];
    }
    out[o++] = abc[(in[15] >> 2) & 63];
    out[o++] = abc[(in[15] & 3) << 4];
    out[o++] = '=';
    out[o++] = '=';
    out[o] = 0;
}

/* Sends one masked client frame (payloads up to 65535 bytes). */
static int ws_send_frame(int opcode, const char *payload, int n) {
    static unsigned char out[65535 + 8];
    unsigned char mask[4];
    int i, h = 0;
    unsigned long r = rnd32();
    if (n > 65535) return -1;
    mask[0] = (unsigned char)(r & 255);
    mask[1] = (unsigned char)((r >> 8) & 255);
    mask[2] = (unsigned char)((r >> 16) & 255);
    mask[3] = (unsigned char)((r >> 24) & 255);
    out[h++] = (unsigned char)(0x80 | opcode);
    if (n < 126) {
        out[h++] = (unsigned char)(0x80 | n);
    } else {
        out[h++] = (unsigned char)(0x80 | 126);
        out[h++] = (unsigned char)((n >> 8) & 255);
        out[h++] = (unsigned char)(n & 255);
    }
    memcpy(out + h, mask, 4);
    h += 4;
    for (i = 0; i < n; i++) out[h + i] = (unsigned char)((unsigned char)payload[i] ^ mask[i & 3]);
    return net_write(out, h + n);
}

static int ws_send_text(const char *text) {
    return ws_send_frame(1, text, (int)strlen(text));
}

/*
 * Reads the next complete text message into g_msg. Answers pings, swallows pongs.
 * Returns the length, or -1 when the connection is closed or broken (g_close_code says why).
 * Messages bigger than MSG_CAP are discarded (the platform never sends one).
 */
static int ws_next_message() {
    int msg_len = 0, msg_ok = 1, in_message = 0;
    for (;;) {
        unsigned char h[8], mask[4];
        int fin, op, masked;
        unsigned long len;
        unsigned long i;
        if (rd(h, 2) != 0) return -1;
        fin = (h[0] & 0x80) != 0;
        op = h[0] & 0x0F;
        masked = (h[1] & 0x80) != 0;
        len = h[1] & 0x7F;
        if (len == 126) {
            if (rd(h, 2) != 0) return -1;
            len = ((unsigned long)h[0] << 8) | h[1];
        } else if (len == 127) {
            if (rd(h, 8) != 0) return -1;
            if (h[0] != 0 || h[1] != 0 || h[2] != 0 || h[3] != 0 || (h[4] & 0x80)) return -1; /* >2 GB: refuse */
            len = ((unsigned long)h[4] << 24) | ((unsigned long)h[5] << 16) | ((unsigned long)h[6] << 8) | h[7];
        }
        if (masked && rd(mask, 4) != 0) return -1;

        if (op >= 8) { /* control frame */
            unsigned char ctrl[125];
            if (len > 125 || rd(ctrl, (int)len) != 0) return -1;
            if (op == 9) {
                if (ws_send_frame(10, (const char *)ctrl, (int)len) != 0) return -1;
            } else if (op == 8) {
                g_close_code = len >= 2 ? (ctrl[0] << 8) | ctrl[1] : 1005;
                if (len > 2) {
                    int n = (int)len - 2;
                    if (n > (int)sizeof g_close_reason - 1) n = (int)sizeof g_close_reason - 1;
                    memcpy(g_close_reason, ctrl + 2, (size_t)n);
                    g_close_reason[n] = 0;
                }
                ws_send_frame(8, (const char *)ctrl, len >= 2 ? 2 : 0); /* answer the close, best effort */
                return -1;
            }
            continue;
        }

        if (op != 0) { /* a new data message (text or binary) */
            msg_len = 0;
            msg_ok = (op == 1);
            in_message = 1;
        } else if (!in_message) {
            return -1; /* continuation without a start */
        }
        for (i = 0; i < len; i++) {
            unsigned char b;
            if (rd(&b, 1) != 0) return -1;
            if (masked) b = (unsigned char)(b ^ mask[i & 3]);
            if (msg_len < MSG_CAP) g_msg[msg_len++] = (char)b;
            else msg_ok = 0;
        }
        if (fin) {
            in_message = 0;
            if (msg_ok) {
                g_msg[msg_len] = 0;
                return msg_len;
            }
            msg_len = 0;
            msg_ok = 1;
        }
    }
}

/* Splits "ws://host[:port][/path]". Returns 0 on success; -2 for wss:// and other bad URLs. */
static int parse_url(const char *url, char *host, int host_cap, int *port, char *path, int path_cap) {
    const char *p = url;
    int i = 0;
    if (strncmp(p, "ws://", 5) != 0) return -2;
    p += 5;
    while (*p != 0 && *p != ':' && *p != '/' && i < host_cap - 1) host[i++] = *p++;
    host[i] = 0;
    *port = 80;
    if (*p == ':') {
        *port = atoi(p + 1);
        while (*p != 0 && *p != '/') p++;
    }
    copy_str(path, path_cap, *p == '/' ? p : "/");
    return (i > 0 && *port > 0 && *port < 65536) ? 0 : -2;
}

/*
 * Opens the connection and does the HTTP upgrade.
 * Returns 0 on success, -1 for a network failure (worth retrying), -2 for a configuration problem
 * (wrong URL or path, HTTPS required: retrying will not help), -3 for a server-side failure (retry).
 */
static int ws_connect(const char *url) {
    char host[128], path[200], req[700], key[32], line[256];
    unsigned char raw[16];
    int port, i, n, status;
    int code = parse_url(url, host, (int)sizeof host, &port, path, (int)sizeof path);
    if (code != 0) return code;
    g_ipos = g_ilen = 0;
    g_close_code = 0;
    g_close_reason[0] = 0;
    if (net_connect(host, port) != 0) return -1;
    for (i = 0; i < 16; i++) raw[i] = (unsigned char)(rnd32() & 255);
    base64_16(raw, key);
    n = 0;
    {
        const char *parts[] = {"GET ", path, " HTTP/1.1\r\nHost: ", host, "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ",
                               key, "\r\nSec-WebSocket-Version: 13\r\n\r\n"};
        for (i = 0; i < 7; i++) {
            int l = (int)strlen(parts[i]);
            if (n + l >= (int)sizeof req) {
                net_close();
                return -2;
            }
            memcpy(req + n, parts[i], (size_t)l);
            n += l;
        }
    }
    if (net_write((const unsigned char *)req, n) != 0) {
        net_close();
        return -1;
    }
    /* Response head: read up to the blank line, keeping the first line and any Location header. */
    {
        char head[2048];
        int hn = 0;
        while (hn < (int)sizeof head - 1) {
            unsigned char c;
            if (rd(&c, 1) != 0) {
                net_close();
                return -1;
            }
            head[hn++] = (char)c;
            if (hn >= 4 && memcmp(head + hn - 4, "\r\n\r\n", 4) == 0) break;
        }
        head[hn] = 0;
        status = (strncmp(head, "HTTP/1.", 7) == 0) ? atoi(head + 9) : 0;
        if (status != 101) {
            const char *eol = strstr(head, "\r\n");
            const char *loc = strstr(head, "ocation:");
            copy_str(line, (int)sizeof line, "");
            if (eol != NULL) {
                int l = (int)(eol - head);
                if (l > (int)sizeof line - 1) l = (int)sizeof line - 1;
                memcpy(line, head, (size_t)l);
                line[l] = 0;
            }
            printf("[bsc] Serverul a raspuns: %s\n", line);
            if (loc != NULL) {
                char target[160];
                int l = 0;
                loc += 8;
                while (*loc == ' ') loc++;
                while (*loc != 0 && *loc != '\r' && l < (int)sizeof target - 1) target[l++] = *loc++;
                target[l] = 0;
                printf("[bsc] Redirectionare catre: %s\n", target);
                say("Serverul cere HTTPS (wss://), iar acest program foloseste doar ws://.");
                say("Cere adminului sa pornesti ws:// pentru contul tau si ia adresa (portul) corecta de la el.");
            }
            net_close();
            if (status == 429 || status >= 500 || status == 0) return -3;
            return -2;
        }
    }
    return 0;
}

/* ================================================================================================
 * Layer 3: JSON tokenizer (just enough for the platform's frames)
 * ============================================================================================== */

enum { J_OBJ = 1, J_ARR = 2, J_STR = 3, J_PRIM = 4 };

struct JTok {
    int type;
    int start; /* first character (after the quote, for strings) */
    int end;   /* one past the last character */
    int size;  /* arrays: elements; objects: key/value pairs */
};

#define JMAX 16384
static JTok g_jt[JMAX];
static int g_jn;
static const char *g_js;

/* Tokenizes s; returns 0 if it is well-formed enough to navigate. */
static int json_parse(const char *s) {
    int stack[32], depth = 0, i = 0;
    g_js = s;
    g_jn = 0;
    while (s[i] != 0) {
        char c = s[i];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == ',' || c == ':') {
            i++;
            continue;
        }
        if (c == '}' || c == ']') {
            if (depth == 0) return -1;
            {
                JTok &t = g_jt[stack[--depth]];
                if ((c == '}') != (t.type == J_OBJ)) return -1;
                t.end = i + 1;
                if (t.type == J_OBJ) t.size /= 2;
            }
            i++;
            continue;
        }
        if (g_jn >= JMAX) return -1;
        {
            JTok &t = g_jt[g_jn];
            if (depth > 0) g_jt[stack[depth - 1]].size++;
            t.size = 0;
            if (c == '{' || c == '[') {
                if (depth >= 32) return -1;
                t.type = (c == '{') ? J_OBJ : J_ARR;
                t.start = i;
                t.end = i;
                stack[depth++] = g_jn++;
                i++;
            } else if (c == '"') {
                int j = i + 1;
                while (s[j] != 0 && s[j] != '"') j += (s[j] == '\\' && s[j + 1] != 0) ? 2 : 1;
                if (s[j] == 0) return -1;
                t.type = J_STR;
                t.start = i + 1;
                t.end = j;
                g_jn++;
                i = j + 1;
            } else {
                int j = i;
                while (s[j] != 0 && s[j] != ',' && s[j] != '}' && s[j] != ']' && s[j] != ' ' && s[j] != '\n' && s[j] != '\r' && s[j] != '\t') j++;
                t.type = J_PRIM;
                t.start = i;
                t.end = j;
                g_jn++;
                i = j;
            }
        }
    }
    return (depth == 0 && g_jn > 0) ? 0 : -1;
}

/* Index of the token after the subtree that starts at token i. */
static int jskip(int i) {
    int k, n = g_jt[i].size, j = i + 1;
    if (g_jt[i].type == J_OBJ) {
        for (k = 0; k < n; k++) j = jskip(j + 1);
    } else if (g_jt[i].type == J_ARR) {
        for (k = 0; k < n; k++) j = jskip(j);
    }
    return j;
}

static int jeq(int t, const char *lit) {
    int n;
    if (t < 0 || g_jt[t].type != J_STR) return 0;
    n = (int)strlen(lit);
    return g_jt[t].end - g_jt[t].start == n && strncmp(g_js + g_jt[t].start, lit, (size_t)n) == 0;
}

/* The value of `key` in object token `obj`, or -1. */
static int jkey(int obj, const char *key) {
    int k, j;
    if (obj < 0 || g_jt[obj].type != J_OBJ) return -1;
    j = obj + 1;
    for (k = 0; k < g_jt[obj].size; k++) {
        if (jeq(j, key)) return j + 1;
        j = jskip(j + 1);
    }
    return -1;
}

/* Dotted path from the root object, e.g. "game.index". */
static int jpath(const char *path) {
    char part[48];
    int t = 0;
    while (*path != 0 && t >= 0) {
        int n = 0;
        while (*path != 0 && *path != '.' && n < (int)sizeof part - 1) part[n++] = *path++;
        part[n] = 0;
        if (*path == '.') path++;
        t = jkey(t, part);
    }
    return t;
}

static int jlen(int arr) {
    return (arr >= 0 && g_jt[arr].type == J_ARR) ? g_jt[arr].size : 0;
}

static int jat(int arr, int idx) {
    int j, k;
    if (arr < 0 || g_jt[arr].type != J_ARR || idx < 0 || idx >= g_jt[arr].size) return -1;
    j = arr + 1;
    for (k = 0; k < idx; k++) j = jskip(j);
    return j;
}

static int jint(int t, int def) {
    int i, neg = 0, v = 0;
    if (t < 0 || g_jt[t].type != J_PRIM) return def;
    i = g_jt[t].start;
    if (g_js[i] == '-') {
        neg = 1;
        i++;
    }
    if (g_js[i] < '0' || g_js[i] > '9') return def;
    for (; i < g_jt[t].end && g_js[i] >= '0' && g_js[i] <= '9'; i++) v = v * 10 + (g_js[i] - '0');
    return neg ? -v : v;
}

static int jtrue(int t) {
    return t >= 0 && g_jt[t].type == J_PRIM && g_jt[t].end - g_jt[t].start == 4 && strncmp(g_js + g_jt[t].start, "true", 4) == 0;
}

static int jnull(int t) {
    return t < 0 || (g_jt[t].type == J_PRIM && g_jt[t].end - g_jt[t].start == 4 && strncmp(g_js + g_jt[t].start, "null", 4) == 0);
}

/* Copies a JSON string, resolving escapes (\uXXXX above the BMP becomes '?'). */
static void jstr(int t, char *out, int cap) {
    int i, o = 0;
    if (t < 0 || g_jt[t].type != J_STR) {
        out[0] = 0;
        return;
    }
    for (i = g_jt[t].start; i < g_jt[t].end && o < cap - 1; i++) {
        char c = g_js[i];
        char bytes[4];
        int nb = 1, k;
        if (c == '\\' && i + 1 < g_jt[t].end) {
            c = g_js[++i];
            if (c == 'n') c = '\n';
            else if (c == 't') c = '\t';
            else if (c == 'r') c = '\r';
            else if (c == 'b') c = '\b';
            else if (c == 'f') c = '\f';
            else if (c == 'u' && i + 4 < g_jt[t].end) {
                unsigned long v = 0;
                for (k = 1; k <= 4; k++) {
                    char h = g_js[i + k];
                    v = v * 16 + (unsigned long)((h >= 'a') ? h - 'a' + 10 : (h >= 'A') ? h - 'A' + 10 : h - '0');
                }
                i += 4;
                if (v < 0x80) {
                    bytes[0] = (char)v;
                } else if (v < 0x800) {
                    bytes[0] = (char)(0xC0 | (v >> 6));
                    bytes[1] = (char)(0x80 | (v & 63));
                    nb = 2;
                } else if (v >= 0xD800 && v < 0xE000) {
                    bytes[0] = '?';
                } else {
                    bytes[0] = (char)(0xE0 | (v >> 12));
                    bytes[1] = (char)(0x80 | ((v >> 6) & 63));
                    bytes[2] = (char)(0x80 | (v & 63));
                    nb = 3;
                }
                if (o + nb > cap - 1) break;
                for (k = 0; k < nb; k++) out[o++] = bytes[k];
                continue;
            }
        }
        out[o++] = c;
    }
    out[o] = 0;
}

/* ================================================================================================
 * Layer 4: protocol
 * ============================================================================================== */

/* Outgoing message builder. */
static char g_out[8192];
static int g_on;

static void sb_reset() {
    g_on = 0;
    g_out[0] = 0;
}
static void sb_s(const char *s) {
    while (*s != 0 && g_on < (int)sizeof g_out - 1) g_out[g_on++] = *s++;
    g_out[g_on] = 0;
}
static void sb_i(int v) {
    char tmp[16];
    int n = 0, neg = v < 0;
    unsigned int u = neg ? (unsigned int)(-v) : (unsigned int)v;
    do {
        tmp[n++] = (char)('0' + u % 10);
        u /= 10;
    } while (u > 0);
    if (neg) sb_s("-");
    while (n > 0) {
        char one[2];
        one[0] = tmp[--n];
        one[1] = 0;
        sb_s(one);
    }
}
static void sb_json(const char *s) {
    sb_s("\"");
    for (; *s != 0; s++) {
        char one[8];
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') {
            one[0] = '\\';
            one[1] = (char)c;
            one[2] = 0;
        } else if (c < 0x20) {
            one[0] = ' ';
            one[1] = 0;
        } else {
            one[0] = (char)c;
            one[1] = 0;
        }
        sb_s(one);
    }
    sb_s("\"");
}

/* Configuration actually used (bot.cpp values, overridden by BSC_* environment variables). */
static char g_url[200], g_token[200], g_lobby[64], g_name[64], g_ruleset[200];
static char g_session[128];
static char g_rid[32];
static int g_welcomed;

static void pick(char *dst, int cap, const char *from_bot, const char *env_name) {
    const char *e = getenv(env_name);
    copy_str(dst, cap, (e != NULL && e[0] != 0) ? e : from_bot);
}

static int send_hello() {
    char list[200];
    int i = 0, first = 1;
    sb_reset();
    sb_s("{\"type\":\"hello\",\"token\":");
    sb_json(g_token);
    sb_s(",\"lobby\":");
    sb_json(g_lobby);
    sb_s(",\"accepts\":[");
    /* bsc_ruleset may hold several ids separated by commas */
    copy_str(list, (int)sizeof list, g_ruleset);
    for (;;) {
        char id[48];
        int n = 0;
        while (list[i] != 0 && list[i] != ',' && n < 47) {
            if (list[i] != ' ') id[n++] = list[i];
            i++;
        }
        id[n] = 0;
        if (n > 0) {
            if (!first) sb_s(",");
            sb_json(id);
            first = 0;
        }
        if (list[i] == ',') i++;
        else break;
    }
    if (first) sb_json("classic-10x10");
    sb_s("],\"program\":{\"name\":");
    sb_json(g_name[0] != 0 ? g_name : "cpp-bot");
    sb_s(",\"version\":\"cpp-shim\"}");
    if (g_session[0] != 0) {
        sb_s(",\"session_id\":");
        sb_json(g_session);
    }
    sb_s("}");
    return ws_send_text(g_out);
}

static void read_rid_and_deadline() {
    int t = jpath("rid");
    int n = 0;
    g_rid[0] = '0';
    g_rid[1] = 0;
    if (t >= 0 && g_jt[t].type == J_PRIM) {
        for (int i = g_jt[t].start; i < g_jt[t].end && n < (int)sizeof g_rid - 1; i++) g_rid[n++] = g_js[i];
        g_rid[n] = 0;
    }
    deadline_ms = jint(jpath("deadline_ms"), 0);
}

static void read_game_context() {
    char who[16];
    int opp, prog;
    game_index = jint(jpath("game.index"), 0);
    game_total = jint(jpath("game.total"), 0);
    jstr(jpath("game.first"), who, (int)sizeof who);
    i_move_first = strcmp(who, "you") == 0;
    opp = jpath("opponent");
    jstr(jkey(opp, "name"), opponent_name, (int)sizeof opponent_name);
    prog = jkey(opp, "program");
    if (jnull(prog)) opponent_program[0] = 0;
    else jstr(jkey(prog, "name"), opponent_program, (int)sizeof opponent_program);
    strikes = jint(jpath("strikes"), 0);
    {
        int err = jpath("error");
        if (jnull(err)) last_error[0] = 0;
        else {
            char msg[160];
            jstr(jkey(err, "code"), last_error, (int)sizeof last_error);
            jstr(jkey(err, "message"), msg, (int)sizeof msg);
            printf("[bsc] Mutare invalida (%s): %s  (strikes: %d/%d)\n", last_error, msg, strikes, limit_max_strikes);
        }
    }
}

static void read_shot(int shot, int *x, int *y, char *result, int *len) {
    char r[16];
    *x = jint(jkey(shot, "x"), -1);
    *y = jint(jkey(shot, "y"), -1);
    jstr(jkey(shot, "result"), r, (int)sizeof r);
    *result = strcmp(r, "miss") == 0 ? R_MISS : strcmp(r, "hit") == 0 ? R_HIT : strcmp(r, "sunk") == 0 ? R_SUNK : R_REPEAT;
    *len = jint(jkey(shot, "len"), 0);
}

static void read_last_shot_and_incoming() {
    int shot = jpath("last_shot"), arr = jpath("incoming"), i, n;
    if (jnull(shot)) {
        last_shot_x = last_shot_y = -1;
        last_shot_result = '-';
        last_shot_len = 0;
    } else {
        read_shot(shot, &last_shot_x, &last_shot_y, &last_shot_result, &last_shot_len);
    }
    n = jlen(arr);
    incoming_count = n < MAX_SHOTS ? n : MAX_SHOTS;
    for (i = 0; i < incoming_count; i++) {
        int len;
        read_shot(jat(arr, i), &incoming_x[i], &incoming_y[i], &incoming_result[i], &len);
    }
}

static void read_board(const char *key, char board[MAX_BOARD][MAX_BOARD + 1]) {
    int arr = jpath(key), y, rows = jlen(arr);
    for (y = 0; y < MAX_BOARD; y++) board[y][0] = 0;
    for (y = 0; y < rows && y < MAX_BOARD; y++) jstr(jat(arr, y), board[y], MAX_BOARD + 1);
}

static void handle_welcome() {
    int fl = jpath("ruleset.fleet"), i;
    my_seat = jint(jpath("seat"), 0);
    jstr(jpath("session_id"), g_session, (int)sizeof g_session);
    jstr(jpath("ruleset.id"), ruleset_id, 48);
    board_w = jint(jpath("ruleset.width"), 0);
    board_h = jint(jpath("ruleset.height"), 0);
    num_ships = jlen(fl) < MAX_SHIPS ? jlen(fl) : MAX_SHIPS;
    for (i = 0; i < num_ships; i++) fleet[i] = jint(jat(fl, i), 0);
    rule_touching_allowed = jtrue(jpath("ruleset.touching"));
    rule_extra_turn_on_hit = jtrue(jpath("ruleset.extra_turn_on_hit"));
    rule_announce_sunk = jtrue(jpath("ruleset.announce_sunk"));
    rule_repeat_wastes_turn = jeq(jpath("ruleset.repeat_shot"), "waste");
    rule_reveal_on_game_over = jtrue(jpath("ruleset.reveal_on_game_over"));
    limit_place_ms = jint(jpath("limits.place_ms"), 0);
    limit_move_ms = jint(jpath("limits.move_ms"), 0);
    limit_max_strikes = jint(jpath("limits.max_strikes"), 0);
    g_welcomed = 1;
    printf("[bsc] Conectat%s. Esti jucatorul %d, regulament \"%s\" (%dx%d, %d nave). Astept ca cineva sa apese Start in site.\n",
           jtrue(jpath("resumed")) ? " (sesiune reluata)" : "", my_seat, ruleset_id, board_w, board_h, num_ships);
}

static void handle_place() {
    int sx[MAX_SHIPS], sy[MAX_SHIPS], i;
    char sd[MAX_SHIPS];
    read_rid_and_deadline();
    read_game_context();
    for (i = 0; i < MAX_SHIPS; i++) {
        sx[i] = sy[i] = 0;
        sd[i] = 'h';
    }
    on_place_ships(sx, sy, sd);
    sb_reset();
    sb_s("{\"type\":\"placement\",\"rid\":");
    sb_s(g_rid);
    sb_s(",\"ships\":[");
    for (i = 0; i < num_ships; i++) {
        if (i > 0) sb_s(",");
        sb_s("{\"len\":");
        sb_i(fleet[i]);
        sb_s(",\"x\":");
        sb_i(sx[i]);
        sb_s(",\"y\":");
        sb_i(sy[i]);
        sb_s(",\"dir\":");
        sb_s((sd[i] == 'v' || sd[i] == 'V') ? "\"v\"" : "\"h\"");
        sb_s("}");
    }
    sb_s("]}");
    ws_send_text(g_out);
}

static void handle_turn() {
    int rem, i, x = 0, y = 0;
    read_rid_and_deadline();
    read_game_context();
    read_board("you", my_board);
    read_board("enemy", enemy_board);
    read_last_shot_and_incoming();
    rem = jpath("enemy_remaining");
    if (jnull(rem)) {
        enemy_remaining_count = -1;
    } else {
        enemy_remaining_count = jlen(rem) < MAX_SHIPS ? jlen(rem) : MAX_SHIPS;
        for (i = 0; i < enemy_remaining_count; i++) enemy_remaining[i] = jint(jat(rem, i), 0);
    }
    on_my_turn(x, y);
    sb_reset();
    sb_s("{\"type\":\"fire\",\"rid\":");
    sb_s(g_rid);
    sb_s(",\"x\":");
    sb_i(x);
    sb_s(",\"y\":");
    sb_i(y);
    sb_s("}");
    ws_send_text(g_out);
}

static void handle_game_over() {
    int rv, i, n;
    jstr(jpath("reason"), game_over_reason, (int)sizeof game_over_reason);
    game_index = jint(jpath("game.index"), 0);
    game_total = jint(jpath("game.total"), 0);
    i_won = jeq(jpath("winner"), "you");
    score_me = jint(jpath("series.score.you"), 0);
    score_opponent = jint(jpath("series.score.opponent"), 0);
    series_done = jtrue(jpath("series.done"));
    read_last_shot_and_incoming();
    rv = jpath("reveal");
    reveal_available = !jnull(rv);
    opp_ship_count = opp_shot_count = 0;
    if (reveal_available) {
        int ships = jkey(rv, "opponent_ships"), shots = jkey(rv, "opponent_shots");
        n = jlen(ships);
        opp_ship_count = n < MAX_SHIPS ? n : MAX_SHIPS;
        for (i = 0; i < opp_ship_count; i++) {
            char d[8];
            int s = jat(ships, i);
            opp_ship_len[i] = jint(jkey(s, "len"), 0);
            opp_ship_x[i] = jint(jkey(s, "x"), 0);
            opp_ship_y[i] = jint(jkey(s, "y"), 0);
            jstr(jkey(s, "dir"), d, (int)sizeof d);
            opp_ship_dir[i] = d[0] == 'v' ? 'v' : 'h';
        }
        n = jlen(shots);
        opp_shot_count = n < MAX_SHOTS ? n : MAX_SHOTS;
        for (i = 0; i < opp_shot_count; i++) {
            int len;
            read_shot(jat(shots, i), &opp_shot_x[i], &opp_shot_y[i], &opp_shot_result[i], &len);
        }
    }
    printf("[bsc] Jocul %d/%d: %s (%s). Scor: tu %d - %d adversar.%s\n", game_index, game_total, i_won ? "AI CASTIGAT" : "AI PIERDUT", game_over_reason,
           score_me, score_opponent, series_done ? " Seria s-a terminat." : "");
    on_game_over();
}

static void handle_reset() {
    jstr(jpath("reason"), reset_reason, (int)sizeof reset_reason);
    printf("[bsc] Reset de la platforma (%s): jocul curent se anuleaza.\n", reset_reason);
    on_reset();
}

static void handle_error() {
    char code[48], msg[200];
    jstr(jpath("code"), code, (int)sizeof code);
    jstr(jpath("message"), msg, (int)sizeof msg);
    printf("[bsc] Eroare de la platforma (%s): %s\n", code, msg);
}

static void dispatch() {
    if (json_parse(g_msg) != 0) {
        say("Mesaj JSON necitibil, il ignor.");
        return;
    }
    {
        int t = jpath("type");
        if (jeq(t, "welcome")) handle_welcome();
        else if (jeq(t, "place")) handle_place();
        else if (jeq(t, "turn")) handle_turn();
        else if (jeq(t, "game_over")) handle_game_over();
        else if (jeq(t, "reset")) handle_reset();
        else if (jeq(t, "error")) handle_error();
    }
}

/* ================================================================================================
 * Layer 5: main loop with reconnection
 * ============================================================================================== */

enum { RETRY = 0, GIVE_UP = 1 };

/* What a close code means, for the console; returns GIVE_UP for problems that retrying cannot fix. */
static int explain_close() {
    int c = g_close_code;
    if (c == 0) {
        say("Conexiunea s-a intrerupt.");
        return RETRY;
    }
    printf("[bsc] Platforma a inchis conexiunea (cod %d%s%s).\n", c, g_close_reason[0] ? ": " : "", g_close_reason);
    if (c == 4400) say("Mesajul hello a fost respins (cerere invalida).");
    else if (c == 4401) say("Autentificare esuata: token gresit, lobby inexistent sau lobby-ul nu este al tau. Verifica bsc_token si codul lobby-ului.");
    else if (c == 4403) say("Contul tau are voie sa foloseasca doar wss://. Cere adminului sa activeze \"Allow ws://\" pentru contul tau (tokenul tau a fost trimis necriptat, ia in calcul sa-l inlocuiesti).");
    else if (c == 4409) say("Lobby-ul nu mai are loc liber pentru tine.");
    else if (c == 4426) say("Regulamentul lobby-ului nu este in bsc_ruleset. Pune regulamentul de mai sus in bsc_ruleset.");
    else if (c == 4000) say("Lobby-ul a fost inchis, tokenul a fost inlocuit, sau s-a conectat alt program pe acelasi loc.");
    return (c == 4400 || c == 4401 || c == 4403 || c == 4409 || c == 4426 || c == 4000) ? GIVE_UP : RETRY;
}

static int run_once() {
    int rc;
    printf("[bsc] Ma conectez la %s ...\n", g_url);
    rc = ws_connect(g_url);
    if (rc == -2) {
        if (strncmp(g_url, "wss://", 6) == 0) say("Acest program nu stie TLS: foloseste adresa ws:// (nu wss://) si cere adminului sa activeze \"Allow ws://\" pentru contul tau.");
        else say("Adresa (bsc_url) sau raspunsul serverului nu sunt bune; nu are rost sa reincerc.");
        return GIVE_UP;
    }
    if (rc != 0) {
        say("Nu m-am putut conecta (server oprit sau adresa gresita?).");
        return RETRY;
    }
    g_welcomed = 0;
    if (send_hello() != 0) {
        net_close();
        return RETRY;
    }
    for (;;) {
        if (ws_next_message() < 0) break;
        dispatch();
    }
    net_close();
    return explain_close();
}

int main() {
    int delay = 1000;
    setvbuf(stdout, NULL, _IONBF, 0);
    srand((unsigned int)time(NULL));
    g_rs ^= (unsigned long)time(NULL) * 2654435761UL;
    g_rs &= 0xFFFFFFFFUL;
    if (g_rs == 0) g_rs = 1;
    pick(g_url, (int)sizeof g_url, bsc_url, "BSC_URL");
    pick(g_token, (int)sizeof g_token, bsc_token, "BSC_TOKEN");
    pick(g_lobby, (int)sizeof g_lobby, bsc_lobby, "BSC_LOBBY");
    pick(g_name, (int)sizeof g_name, bsc_name, "BSC_NAME");
    pick(g_ruleset, (int)sizeof g_ruleset, bsc_ruleset, "BSC_RULESET");
    if (g_token[0] == 0 || strncmp(g_token, "bsc_", 4) != 0) {
        say("Completeaza bsc_token in bot.cpp cu tokenul de pe pagina Cont din site.");
        return 1;
    }
    if (g_lobby[0] == 0) {
        printf("Codul lobby-ului (ex. K7QM-4XD2-7): ");
        if (scanf("%63s", g_lobby) != 1) return 1;
    }
    for (;;) {
        if (run_once() == GIVE_UP) return 1;
        sleep_ms(delay);
        delay = g_welcomed ? 1000 : (delay < 10000 ? delay * 2 : 10000);
    }
}
