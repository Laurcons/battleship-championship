// A test-only student program: prints every global the shim fills in, one JSON object per event,
// so tests can compare them with the frames the (real or scripted) platform sent.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bsc.h"

char bsc_url[] = "ws://127.0.0.1:1/program/v1";
#ifdef PROBE_NO_TOKEN
char bsc_token[] = "";
#else
char bsc_token[] = "bsc_00000000000000000000000000000000";
#endif
char bsc_lobby[] = "";
char bsc_name[] = "probe";
char bsc_ruleset[] = "classic-10x10";

static void str(const char *key, const char *v) {
    printf("\"%s\":\"", key);
    for (; *v; v++) {
        if (*v == '"' || *v == '\\') printf("\\%c", *v);
        else if ((unsigned char)*v < 0x20) printf("\\u%04x", *v);
        else putchar(*v);
    }
    printf("\",");
}
static void num(const char *key, int v) { printf("\"%s\":%d,", key, v); }
static void chr(const char *key, char v) { printf("\"%s\":\"%c\",", key, v); }
static void ints(const char *key, const int *v, int n) {
    printf("\"%s\":[", key);
    for (int i = 0; i < n; i++) printf("%s%d", i ? "," : "", v[i]);
    printf("],");
}
static void chars(const char *key, const char *v, int n) {
    printf("\"%s\":\"", key);
    for (int i = 0; i < n; i++) putchar(v[i]);
    printf("\",");
}
static void rows(const char *key, char b[MAX_BOARD][MAX_BOARD + 1]) {
    printf("\"%s\":[", key);
    for (int y = 0; y < board_h; y++) printf("%s\"%s\"", y ? "," : "", b[y]);
    printf("],");
}
static void common() {
    num("seat", my_seat);
    str("ruleset", ruleset_id);
    num("w", board_w);
    num("h", board_h);
    ints("fleet", fleet, num_ships);
    num("touching", rule_touching_allowed);
    num("extra", rule_extra_turn_on_hit);
    num("announce", rule_announce_sunk);
    num("waste", rule_repeat_wastes_turn);
    num("reveal_rule", rule_reveal_on_game_over);
    num("place_ms", limit_place_ms);
    num("move_ms", limit_move_ms);
    num("max_strikes", limit_max_strikes);
    num("game", game_index);
    num("total", game_total);
    num("first", i_move_first);
    str("opp", opponent_name);
    str("opp_prog", opponent_program);
    num("deadline", deadline_ms);
    num("strikes", strikes);
    str("error", last_error);
}
static void begin(const char *ev) { printf("PROBE {\"event\":\"%s\",", ev); }
static void end() { printf("\"end\":1}\n"); }

void on_place_ships(int ship_x[], int ship_y[], char ship_dir[]) {
    begin("place");
    common();
    end();
    for (int i = 0; i < num_ships; i++) {
        ship_x[i] = 0;
        ship_y[i] = 2 * i;
        ship_dir[i] = (getenv("PROBE_VERTICAL") && i == 0) ? 'v' : 'h';
    }
    if (getenv("PROBE_VERTICAL")) { ship_x[0] = 9; ship_y[0] = 0; }
}

void on_my_turn(int &x, int &y) {
    begin("turn");
    common();
    rows("you", my_board);
    rows("enemy", enemy_board);
    num("last_x", last_shot_x);
    num("last_y", last_shot_y);
    chr("last_result", last_shot_result);
    num("last_len", last_shot_len);
    num("in_n", incoming_count);
    ints("in_x", incoming_x, incoming_count);
    ints("in_y", incoming_y, incoming_count);
    chars("in_r", incoming_result, incoming_count);
    num("rem_n", enemy_remaining_count);
    ints("rem", enemy_remaining, enemy_remaining_count < 0 ? 0 : enemy_remaining_count);
    end();
    const char *shot = getenv("PROBE_SHOT");
    if (shot && sscanf(shot, "%d,%d", &x, &y) == 2) return;
    for (y = 0; y < board_h; y++)
        for (x = 0; x < board_w; x++)
            if (enemy_board[y][x] == '.') return;
}

void on_game_over() {
    begin("game_over");
    num("game", game_index);
    num("total", game_total);
    num("won", i_won);
    str("reason", game_over_reason);
    num("score_me", score_me);
    num("score_opp", score_opponent);
    num("done", series_done);
    num("last_x", last_shot_x);
    num("last_y", last_shot_y);
    chr("last_result", last_shot_result);
    num("last_len", last_shot_len);
    num("in_n", incoming_count);
    ints("in_x", incoming_x, incoming_count);
    ints("in_y", incoming_y, incoming_count);
    chars("in_r", incoming_result, incoming_count);
    num("reveal", reveal_available);
    num("ships", opp_ship_count);
    ints("ship_len", opp_ship_len, opp_ship_count);
    ints("ship_x", opp_ship_x, opp_ship_count);
    ints("ship_y", opp_ship_y, opp_ship_count);
    chars("ship_dir", opp_ship_dir, opp_ship_count);
    num("shots", opp_shot_count);
    ints("shot_x", opp_shot_x, opp_shot_count);
    ints("shot_y", opp_shot_y, opp_shot_count);
    chars("shot_r", opp_shot_result, opp_shot_count);
    end();
}

void on_reset() {
    begin("reset");
    str("reason", reset_reason);
    end();
}
