/*
 * bsc.h - the contract between the C++ shim (bsc.cpp) and a student's program (bot.cpp).
 *
 * Students never edit this file or bsc.cpp. Everything here is documented, in Romanian, in bot.cpp.
 * The shim owns main(): it connects, speaks the platform protocol (docs/protocol-v1.md) and calls
 * the four on_* functions below, after filling in the global variables.
 *
 * Plain C-style C++98 on purpose: no classes, no std::string, no templates, no libraries to install.
 */
#ifndef BSC_H
#define BSC_H

/* Largest sizes the platform allows (see MAX_BOARD_SIDE and MAX_FLEET_SIZE in packages/engine). */
#define MAX_BOARD 20
#define MAX_SHIPS 10
#define MAX_SHOTS (MAX_BOARD * MAX_BOARD)

/* Shot results, for last_shot_result, incoming_result[] and opp_shot_result[]. */
#define R_MISS 'm'
#define R_HIT 'h'
#define R_SUNK 's'
#define R_REPEAT 'r'

/* --- defined by the student in bot.cpp ---------------------------------------------------------- */
extern char bsc_url[];
extern char bsc_token[];
extern char bsc_lobby[];
extern char bsc_name[];
extern char bsc_ruleset[];

void on_place_ships(int ship_x[], int ship_y[], char ship_dir[]);
void on_my_turn(int &x, int &y);
void on_game_over();
void on_reset();

/* --- defined by the shim in bsc.cpp; read-only for the student ---------------------------------- */

/* ruleset and limits (after "welcome") */
extern int my_seat;
extern char ruleset_id[];
extern int board_w, board_h;
extern int num_ships;
extern int fleet[MAX_SHIPS];
extern int rule_touching_allowed, rule_extra_turn_on_hit, rule_announce_sunk;
extern int rule_repeat_wastes_turn, rule_reveal_on_game_over;
extern int limit_place_ms, limit_move_ms, limit_max_strikes;

/* the current game (from "place" on) */
extern int game_index, game_total, i_move_first;
extern char opponent_name[];
extern char opponent_program[];
extern int deadline_ms;
extern int strikes;
extern char last_error[];

/* the current turn (from "turn" on) */
extern char my_board[MAX_BOARD][MAX_BOARD + 1];
extern char enemy_board[MAX_BOARD][MAX_BOARD + 1];
extern int last_shot_x, last_shot_y;
extern char last_shot_result;
extern int last_shot_len;
extern int incoming_count;
extern int incoming_x[MAX_SHOTS], incoming_y[MAX_SHOTS];
extern char incoming_result[MAX_SHOTS];
extern int enemy_remaining_count;
extern int enemy_remaining[MAX_SHIPS];

/* the end of a game (inside on_game_over) */
extern int i_won;
extern char game_over_reason[];
extern int score_me, score_opponent, series_done;
extern int reveal_available;
extern int opp_ship_count;
extern int opp_ship_len[MAX_SHIPS], opp_ship_x[MAX_SHIPS], opp_ship_y[MAX_SHIPS];
extern char opp_ship_dir[MAX_SHIPS];
extern int opp_shot_count;
extern int opp_shot_x[MAX_SHOTS], opp_shot_y[MAX_SHOTS];
extern char opp_shot_result[MAX_SHOTS];

/* reset (inside on_reset) */
extern char reset_reason[];

#endif
