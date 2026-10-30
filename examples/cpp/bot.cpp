/*
 * bot.cpp - AICI scrii programul tău pentru Battleships Championship.
 *
 * Acesta este singurul fișier pe care îl modifici. Fișierele bsc.h și bsc.cpp (shim-ul) se ocupă de
 * rețea: se conectează la platformă, citesc mesajele și îți apelează funcțiile de mai jos, după ce
 * au completat variabilele globale. Tu nu ai de-a face cu WebSocket, JSON sau rețea.
 *
 * CUM FUNCȚIONEAZĂ
 *   1. Completezi configurarea din secțiunea A (adresa platformei și tokenul tău).
 *   2. Pornești programul. Dacă bsc_lobby este gol, îți cere codul lobby-ului (îl vezi în site).
 *   3. Când cineva apasă „Start” în site, platforma îți apelează, pe rând, funcțiile din secțiunea C:
 *        on_place_ships - începe un joc: îți pui navele
 *        on_my_turn     - e rândul tău: alegi unde tragi
 *        on_game_over   - jocul s-a terminat
 *        on_reset       - platforma a anulat jocul curent
 *   4. O serie (battery) are mai multe jocuri. Când game_index == 1 începe o serie nouă.
 *      Ce ții minte între jocurile aceleiași serii (variabile globale ale tale) este permis;
 *      între serii nu ai voie să păstrezi nimic (fișiere, baze de date etc.).
 *
 * REGULI
 *   - Nu modifica bsc.h și bsc.cpp. Variabilele din secțiunea B sunt DOAR pentru citit. Modificarile aduse lor nu sunt luate in considerare.
 *   - Coordonatele încep de la 0. x este coloana, y este rândul: my_board[y][x], enemy_board[y][x].
 *   - Poți folosi printf / cout pentru a afișa ce vrei în consolă.
 *   - Shim-ul a apelat deja srand(time(NULL)), deci poți folosi direct rand().
 *   - Dacă platforma refuză o mutare, ți se cere din nou aceeași mutare, cu last_error completat
 *     și strikes mărit. După limit_max_strikes mutări invalide pierzi jocul.
 *   - Dacă se pierde conexiunea, shim-ul se reconectează singur și jocul continuă. Programul se oprește
 *     (cu un mesaj în consolă) doar când reîncercarea nu ajută: token greșit, lobby greșit, regulament
 *     care nu e în bsc_ruleset, ws:// nepermis contului tău, lobby închis sau tokenul înlocuit.
 *
 * Constante (din bsc.h):
 *   MAX_BOARD = 20 (latura maximă a tablei), MAX_SHIPS = 10 (nave maxim), MAX_SHOTS = 400 (trageri maxim).
 *   Rezultatele unei trageri: R_MISS = 'm' (ratat), R_HIT = 'h' (lovit), R_SUNK = 's' (scufundat),
 *   R_REPEAT = 'r' (celulă trasă deja).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "bsc.h"

/* ==================================================================================================
 * A. CONFIGURARE (le completezi o singură dată)
 * ================================================================================================ */

/* Adresa platformei, oferita de Bubu */
char bsc_url[] = "ws://battleship-championship.laurcons.ro/program/v1";

/* Tokenul tău, creat pe pagina „Cont” din site (începe cu bsc_). Este secret: nu îl da nimănui. */
char bsc_token[] = "bsc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

/* Codul lobby-ului (ex. "K7QM-4XD2-7"). Dacă îl lași gol "", programul îl cere la pornire. */
char bsc_lobby[] = "";

/* Numele programului tău, așa cum îl vede adversarul (maxim 64 de caractere). */
char bsc_name[] = "botul-meu v1.0";

/* Regulamentele pe care programul tău știe să le joace (ex. "classic-10x10"); mai multe se separă
 * prin virgulă. Dacă lobby-ul folosește alt regulament, conexiunea este refuzată și mesajul îți
 * spune ce regulament are lobby-ul. */
char bsc_ruleset[] = "classic-10x10";

/* ==================================================================================================
 * B. VARIABILE GLOBALE (completate de shim; doar de citit)
 * ================================================================================================ */

/* --- B1. Setul de reguli (regulamentul) (valabil în toate funcțiile) ---------------------------------------------
 *
 * int  my_seat                    locul tău în lobby: 1 sau 2
 * char ruleset_id[]               id-ul regulamentului, ex. "classic-10x10"
 * int  board_w, board_h           numărul de coloane și de rânduri ale tablei (între 5 și 20)
 * int  num_ships                  câte nave ai
 * int  fleet[]                    lungimile navelor; nava i (0 <= i < num_ships) are lungimea fleet[i]
 * int  rule_touching_allowed      1 = navele pot să se atingă (și pe diagonală); 0 = nu pot
 * int  rule_extra_turn_on_hit     1 = după o lovitură tragi din nou
 * int  rule_announce_sunk         1 = ți se spune când ai scufundat o navă (R_SUNK, last_shot_len,
 *                                     enemy_remaining, '#'); 0 = scufundarea apare ca simplu R_HIT
 * int  rule_repeat_wastes_turn    1 = o tragere într-o celulă trasă deja nu e greșeală: primești
 *                                     R_REPEAT și pierzi tura; 0 = e mutare invalidă (strike)
 * int  rule_reveal_on_game_over   1 = la sfârșitul jocului afli unde au fost navele adversarului
 * int  limit_place_ms             timpul maxim pentru plasarea navelor (milisecunde)
 * int  limit_move_ms              timpul maxim pentru o tragere (milisecunde)
 * int  limit_max_strikes          câte mutări invalide poți face într-un joc înainte să-l pierzi
 */

/* --- B2. Jocul curent (completate înainte de on_place_ships și rămân valabile până la sfârșit) --
 *
 * int  game_index                 al câtelea joc din serie este (începe de la 1); 1 = serie nouă
 * int  game_total                 câte jocuri are seria
 * int  i_move_first               1 = tu muți primul în acest joc
 * char opponent_name[]            numele adversarului (un participant sau un bot de antrenament)
 * char opponent_program[]         numele programului adversarului; șir gol dacă nu l-a spus
 * int  deadline_ms                în câte milisecunde de la primirea cererii trebuie să răspunzi
 * int  strikes                    câte mutări invalide ai făcut în acest joc
 * char last_error[]               dacă răspunsul tău anterior a fost invalid, codul erorii
 *                                 ("out_of_bounds", "already_fired", "bad_fleet", "ship_out_of_bounds",
 *                                 "ships_overlap", "ships_touching", "bad_shape"); altfel șir gol ""
 */

/* --- B3. Tura curentă (completate înainte de on_my_turn; în on_game_over rămân ultimele valori) -
 *
 * char my_board[y][x]             tabla ta, rând cu rând (fiecare rând este un șir de caractere):
 *                                   '.' apă netrasă   'o' adversarul a tras aici și a ratat
 *                                   'S' navă a ta întreagă   'x' navă a ta lovită
 * char enemy_board[y][x]          ce știi despre tabla adversarului:
 *                                   '.' netras   'o' ai ratat   'x' ai lovit
 *                                   '#' celulă dintr-o navă scufundată (doar dacă rule_announce_sunk)
 * int  last_shot_x, last_shot_y   unde ai tras data trecută
 * char last_shot_result           rezultatul ei: R_MISS, R_HIT, R_SUNK sau R_REPEAT
 * int  last_shot_len              lungimea navei scufundate (doar când last_shot_result == R_SUNK)
 *                                 La prima ta tură dintr-un joc nu există tragere anterioară:
 *                                 last_shot_x = last_shot_y = -1, last_shot_result = '-'.
 * int  incoming_count             câte trageri a făcut adversarul de la ultima ta tură
 * int  incoming_x[], incoming_y[] unde a tras, în ordinea tragerilor (indici 0 .. incoming_count-1)
 * char incoming_result[]          rezultatele lor: R_MISS, R_HIT, R_SUNK sau R_REPEAT
 *                                 (incoming_count este 0 după ce ai lovit, dacă tragi din nou)
 * int  enemy_remaining_count      câte nave ale adversarului nu sunt scufundate; -1 dacă regulamentul
 *                                 nu anunță scufundările (rule_announce_sunk == 0)
 * int  enemy_remaining[]          lungimile lor (indici 0 .. enemy_remaining_count-1)
 */

/* --- B4. Sfârșitul jocului (valabile în on_game_over) ------------------------------------------
 *
 * int  i_won                      1 = ai câștigat jocul, 0 = ai pierdut
 * char game_over_reason[]         "sunk" (toate navele scufundate), "timeout" (cineva n-a răspuns la timp),
 *                                 "strikes" (prea multe mutări invalide) sau "disconnect"
 * int  score_me, score_opponent   scorul seriei după acest joc
 * int  series_done                1 = acesta a fost ultimul joc din serie
 * int  reveal_available           1 = datele opp_* de mai jos sunt completate
 *                                 (altfel regulamentul nu dezvăluie nimic: rule_reveal_on_game_over == 0)
 * int  opp_ship_count             câte nave a avut adversarul
 * int  opp_ship_len[], opp_ship_x[], opp_ship_y[], opp_ship_dir[]
 *                                 nava i a adversarului: lungime, prima celulă, direcție ('h' spre dreapta
 *                                 sau 'v' în jos), exact ca la on_place_ships
 * int  opp_shot_count             câte trageri a făcut adversarul în tot jocul
 * int  opp_shot_x[], opp_shot_y[], opp_shot_result[]
 *                                 tragerile lui, în ordine (R_MISS, R_HIT, R_SUNK, R_REPEAT)
 * În on_game_over, last_shot_* și incoming_* conțin ultimele trageri: cea a ta (last_shot_x = -1 dacă nu
 * ai tras deloc) și cele ale adversarului de la ultima ta tură. my_board și enemy_board rămân cele de la
 * ultima ta tură (nu includ ultimele trageri).
 */

/* --- B5. Reset (valabil în on_reset) ------------------------------------------------------------
 *
 * char reset_reason[]             "restart_game" (jocul curent se anulează și se joacă din nou),
 *                                 "reset_series" (toată seria se anulează) sau
 *                                 "series_stopped" (seria s-a oprit la prima greșeală, cum cere lobby-ul)
 */

/* ==================================================================================================
 * C. FUNCȚIILE TALE (sunt apelate automat; returneaza numai prin parametri)
 * ================================================================================================ */

/*
 * on_place_ships - începutul unui joc: îți pui navele.
 *
 * Parametri (tablouri pe care TU le completezi, pentru i = 0 .. num_ships-1):
 *   ship_x[i], ship_y[i]  prima celulă a navei i (cea mai din stânga sau cea mai de sus)
 *   ship_dir[i]           'h' = nava se întinde spre dreapta (x crește), 'v' = în jos (y crește)
 * Nava i are lungimea fleet[i]. Toate navele trebuie să încapă pe tablă, să nu se suprapună și, dacă
 * rule_touching_allowed == 0, să nu se atingă nici pe diagonală. Altfel primești strike și funcția
 * este apelată din nou (cu last_error completat).
 *
 * Când game_index == 1 începe o serie nouă: aici îți resetezi ce ai învățat despre adversar.
 *
 * Exemplu: nava i pe rândul 2*i, de la coloana 0, spre dreapta. E corect pentru regulamentul clasic
 * (5 nave pe 10x10), dar nu pentru orice regulament, și e ușor de ghicit de adversar.
 */
void on_place_ships(int ship_x[], int ship_y[], char ship_dir[]) {
    for (int i = 0; i < num_ships; i++) {
        ship_x[i] = 0;
        ship_y[i] = 2 * i;
        ship_dir[i] = 'h';
    }
}

/*
 * on_my_turn - e rândul tău: alegi unde tragi.
 *
 * Parametri (referințe; le completezi TU):
 *   x  coloana celulei în care tragi (0 .. board_w-1)
 *   y  rândul celulei în care tragi (0 .. board_h-1)
 * Celula trebuie să fie în tablă și, dacă rule_repeat_wastes_turn == 0, netrasă încă
 * (enemy_board[y][x] == '.'). Citește starea din secțiunea B3.
 * Dacă lovești și rule_extra_turn_on_hit == 1, funcția este apelată din nou imediat.
 *
 * Exemplu: o celulă netrasă aleasă la întâmplare (mereu există una când e rândul tău).
 */
void on_my_turn(int &x, int &y) {
    do {
        x = rand() % board_w;
        y = rand() % board_h;
    } while (enemy_board[y][x] != '.');
}

/*
 * on_game_over - jocul s-a terminat (fără parametri; nu trebuie să răspunzi nimic).
 *
 * Aici citești secțiunea B4 (cine a câștigat, scorul, unde au fost navele adversarului) și poți învăța
 * din ele pentru jocurile următoare ale aceleiași serii (de exemplu: unde își pune el navele, unde
 * trage). Dacă seria continuă, imediat după aceea shim-ul apelează on_place_ships pentru jocul următor.
 */
void on_game_over() {
}

/*
 * on_reset - platforma a anulat jocul curent (fără parametri; nu trebuie să răspunzi nimic).
 *
 * Motivul este în reset_reason. Șterge orice stare a jocului curent pe care o ții în variabile
 * globale; dacă reset_reason este "reset_series", șterge și ce ai învățat despre adversar în serie.
 * Urmează un nou on_place_ships.
 */
void on_reset() {
}
