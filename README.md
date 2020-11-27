# haxball-bot
A bot for [Haxball online game](https://www.haxball.com).

Players are greeted first then they are automatically fielded with teams balancing when joining to the room; chosen players are given admin rights. Teams balancing is done on player leave too. A simple chat CLI (for admins) provides shortcuts for recurring operations like team change, start/stop/restart the game with a provided stadium and enable game autostart.
For example, just type

    !restart big
to restart the game using the "Big" stadium.

### Installation
This bot is provided as a [Tampermonkey](https://www.tampermonkey.net/) user-script, `haxball-bot.user.js`, injected at https://www.haxball.com/headless, but it works also by copy and paste it at the same URL in the Javascript console.
It requires `unsafeWindow` feature to catch a reference to Haxball API.
[Greasemonkey](https://www.greasespot.net/) currently is not supported.

### Configuration
Just change the parameters at the beginning of the script, like `ROOM_NAME`,
`MAX_PLAYERS`, etc.

### Chat CLI
Commands are:

    !help
display some info on bot and summary of commands;

    !start [STADIUM]?
    !stop
    !restart [STADIUM]?
start, stop, restart game with optional `[STADIUM]` parameter, that is whatever stadium in lowercase (e.g. `classic`, `hockey`);

    !pause
toggle pause on current game; this is a... longcut for just pressing `p`;

    !go [TEAM]
move to `red`, `blue` team or `spec` (spectators);

    !as [on|off]
enable/disable autostart feature. If enabled, on team victory a new game is started after some seconds, possibly adapting the stadium according to current player number ("Classic" up to 4 players, "Big" otherwise).

Arbitrary blanks are allowed between tokens, so `!gored` is the same of `! go red`.
The CLI parser was generated from the translation scheme in `haxball-bot.parser` (EBNF) by [PEG.js](https://pegjs.org) parser generator, and it was appended in the `initParser()` function.
