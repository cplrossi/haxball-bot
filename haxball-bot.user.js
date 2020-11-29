// ==UserScript==
// @name         haxball-bot
// @namespace    https://cplrossi.chickenkiller.com
// @version      0.1
// @description  get a basic CLI and automation on HaxBall game (https://www.haxball.com)
// @author       cplrossi
// @match        https://www.haxball.com/headless
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

/* Haxball-bot by cplrossi
 * CLI grammar is in haxball-bot.parser, used by PEG.js to generate a parser
 * Use Tampermonkey or past this script at https://www.haxball.com/headless
 */
const BOT_NAME = "haxball-bot";
const BOT_VERSION = "0.1";

/*************************************************************
 *  Room config                                             /*
 */ const ROOM_NAME = "My Great Room";                      /*
 */ const MAX_PLAYERS = 6;                                  /*
 */ const PUBLIC = true;                                    /*
 */ const PASSWORD = null;                                  /*
 */ const ADMINS = ["Tracy", "John"];                       /*
 */ const SCORE_LIMIT = 5;                                  /*
 */ const TIME_LIMIT = 0;  /* in minutes, 0 is no limit */  /*
 */ const DEFAULT_STADIUM = "Big";   /* need capitalize */  /*
 *************************************************************/

/* Retry to get Haxball API reference with SCRIPT_DELAY ms rate.
* I think this is needed because of async loading of inner iframe
* scripts in www.haxball.com/headless page, so it messes up with
* load events; do you have a better way to do it?
*/
const SCRIPT_DELAY = 200;

/* Teams enum */
const Team = Object.freeze({
	SPEC: 0,
	RED: 1,
	BLUE: 2
});

/* Returned by generated parser */
class CliCmd {
	constructor(cmd, params) {
		this.cmd = cmd;
		this.params = params;
	}
}

/* Globals */
let room;
let parser;
let configAutostart = false;
let isStopped = true; // set by onGameStart() / onGameStop() handlers
let isPaused = false; // set by onGamePause() / onGameUnpause() handlers

/* CLI definition */
const Cli = Object.freeze({
	help: (p, arg) => room.sendAnnouncement(BOT_NAME + " v" + BOT_VERSION +
	"\nCommands are: help, start [STADIUM]?, restart [STADIUM]?, stop, pause, go [TEAM], as [on|off]" +
	"\nTeams are: red, blue, spec" +
	"\nStadiums are all the valid ones, in lowercase, e.g. 'big'" +
	"\nas is AutoStart" +
	"\nEnjoy!"),
	start: (p, s) => {
		if (s != null) room.setDefaultStadium(s);
		room.startGame();
		room.sendAnnouncement("Let's go");
	},
	restart: (p, s) => {
		room.stopGame();

		room.sendAnnouncement("Restarting...");

		Cli.start(p, s);
	},
	stop: (p, arg) => {
		isStopped = true;

		room.stopGame();
	},
	pause: (p, arg) => {
		if (isStopped) {
			room.sendAnnouncement(p.name + ", game is stopped...");
			return;
		}

		if (!isPaused) {
			room.pauseGame(true);

			room.sendAnnouncement("Pause");
		}
		else {
			room.pauseGame(false);

			room.sendAnnouncement("Unpause");
		}
	},
	go: (p, t) => {
		room.setPlayerTeam(p.id, t);
	},
	autostart: (p, e) => {
		configAutostart = e;

		let msg = "Autostart " + (e == true? "enabled" : "disabled");
		console.log(msg);
		room.sendAnnouncement(msg);
	},
	panic: (p, arg) => room.sendAnnouncement("Wtf?")
});

/* Access control functions */
function checkAdmin(p) {
	return p.admin;
}

/* Generic sleep used for init and autostart delay */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/* Bot Entry Point */
(async () => {
	while (typeof unsafeWindow.HBInit == 'undefined') {
		await sleep(SCRIPT_DELAY);

		console.log("Waiting for Haxball API...");
	}

	console.log("Found Haxball API");

	/* Catching Haxball API reference in the global scope */
	room = unsafeWindow.HBInit({	// RoomConfigObject
		roomName: ROOM_NAME,
		maxPlayers: MAX_PLAYERS,
		noPlayer: true,				// Remove host player (recommended!)
		password: PASSWORD,
		public: PUBLIC				// Public room
	});

	init();
})();

/* Room init */
function init() {
	console.log("CLI parser init");

	initParser();

	console.log("Room init");

	room.setDefaultStadium(DEFAULT_STADIUM);
	room.setScoreLimit(SCORE_LIMIT);
	room.setTimeLimit(TIME_LIMIT);

	/* Event Listeners */
	room.onPlayerJoin = function (p) {
		/* Give admin rights to right people */
		if (ADMINS.includes(p.name)) {
			room.setPlayerAdmin(p.id, true);
		}

		/* Field the new player keeping team balancing */
		let players = room.getPlayerList();
		let playerCount = [0, 0, 0];

		players.forEach((p) => {
			playerCount[p.team]++;
		});

		if (playerCount[Team.BLUE] < playerCount[Team.RED]) {
			room.setPlayerTeam(p.id, Team.BLUE);
		}
		else {
			room.setPlayerTeam(p.id, Team.RED);
		}

		/* Deliver good news */
		let msg = "Hi, " + p.name + "!";
		console.log(msg);
		room.sendAnnouncement(msg);
	}

	room.onPlayerLeave = function (playerGone) {
		/* Deliver bad news */
		let msg = ":(";
		console.log(msg);
		room.sendAnnouncement(msg);

		let players = room.getPlayerList();
		let playerCount = [0, 0, 0];

		players.forEach((p) => {
			playerCount[p.team]++;
		});

		/* Balance teams */
		let otherTeam;
		if (playerGone.team == Team.RED) {
			otherTeam = Team.BLUE;
		}
		else otherTeam = Team.RED;

		if (playerCount[playerGone.team] == playerCount[otherTeam] - 2) {
			let BreakException = {};

			try {
				players.forEach((p) => {
					if (p.team == otherTeam) {
						room.setPlayerTeam(p.id, playerGone.team);

						throw BreakException;
					}
				});
			} catch (e) {
				room.sendAnnouncement("Teams balanced");
			}
		}
	}

	room.onPlayerChat = function (p, s) {
		if (s.charAt(0) == '!') {
			if (checkAdmin(p)) {
				/* Chat CLI */
				try {
					/* The parser returns a CliCmd instance */
					let action = parser.parse(s);
					action.cmd(p, action.params);
				} catch (error) {
					//room.sendAnnouncement(error.message);
					Cli.panic(p, null);
				}
			}
			else {
				room.sendAnnouncement(p.name + ", you're not admin.");
			}
		}
	}

	room.onTeamVictory = function (s) {
		isStopped = true;

		if (configAutostart == true) {
			let delay = 10;

			(async () => {
				let msg = "Starting in " + delay + " seconds...";

				console.log(msg);
				room.sendAnnouncement(msg);

				for (let i = delay; i > 0; --i) {
					if (configAutostart && isStopped) {
						console.log(i)

						await sleep(1000);
					}
					else return;
				}

				room.stopGame();

				/* Resize stadium according to an empirical convention */
				if (room.getPlayerList().length <= 4) {
					room.setDefaultStadium("Classic");
				}
				else room.setDefaultStadium("Big");

				room.startGame();
			})();
		}
	}

	room.onGameStart = function (p) {
		isStopped = false;
	}

	room.onGameStop = function (p) {
		isStopped = true;
	}

	room.onGamePause = function (p) {
		isPaused = true;
	}

	room.onGameUnpause = function (p) {
		isPaused = false;
	}

	console.log("Ready");
}

/* CLI Parser (up to end of file) */
function initParser() {
	parser = /*
	* Generated by PEG.js 0.10.0.
	*
	* http://pegjs.org/
	*/
	(function() {
		"use strict";

		function peg$subclass(child, parent) {
			function ctor() { this.constructor = child; }
			ctor.prototype = parent.prototype;
			child.prototype = new ctor();
		}

		function peg$SyntaxError(message, expected, found, location) {
			this.message  = message;
			this.expected = expected;
			this.found    = found;
			this.location = location;
			this.name     = "SyntaxError";

			if (typeof Error.captureStackTrace === "function") {
				Error.captureStackTrace(this, peg$SyntaxError);
			}
		}

		peg$subclass(peg$SyntaxError, Error);

		peg$SyntaxError.buildMessage = function(expected, found) {
			var DESCRIBE_EXPECTATION_FNS = {
				literal: function(expectation) {
					return "\"" + literalEscape(expectation.text) + "\"";
				},

				"class": function(expectation) {
					var escapedParts = "",
					i;

					for (i = 0; i < expectation.parts.length; i++) {
						escapedParts += expectation.parts[i] instanceof Array
						? classEscape(expectation.parts[i][0]) + "-" + classEscape(expectation.parts[i][1])
						: classEscape(expectation.parts[i]);
					}

					return "[" + (expectation.inverted ? "^" : "") + escapedParts + "]";
				},

				any: function(expectation) {
					return "any character";
				},

				end: function(expectation) {
					return "end of input";
				},

				other: function(expectation) {
					return expectation.description;
				}
			};

			function hex(ch) {
				return ch.charCodeAt(0).toString(16).toUpperCase();
			}

			function literalEscape(s) {
				return s
				.replace(/\\/g, '\\\\')
				.replace(/"/g,  '\\"')
				.replace(/\0/g, '\\0')
				.replace(/\t/g, '\\t')
				.replace(/\n/g, '\\n')
				.replace(/\r/g, '\\r')
				.replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
				.replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
			}

			function classEscape(s) {
				return s
				.replace(/\\/g, '\\\\')
				.replace(/\]/g, '\\]')
				.replace(/\^/g, '\\^')
				.replace(/-/g,  '\\-')
				.replace(/\0/g, '\\0')
				.replace(/\t/g, '\\t')
				.replace(/\n/g, '\\n')
				.replace(/\r/g, '\\r')
				.replace(/[\x00-\x0F]/g,          function(ch) { return '\\x0' + hex(ch); })
				.replace(/[\x10-\x1F\x7F-\x9F]/g, function(ch) { return '\\x'  + hex(ch); });
			}

			function describeExpectation(expectation) {
				return DESCRIBE_EXPECTATION_FNS[expectation.type](expectation);
			}

			function describeExpected(expected) {
				var descriptions = new Array(expected.length),
				i, j;

				for (i = 0; i < expected.length; i++) {
					descriptions[i] = describeExpectation(expected[i]);
				}

				descriptions.sort();

				if (descriptions.length > 0) {
					for (i = 1, j = 1; i < descriptions.length; i++) {
						if (descriptions[i - 1] !== descriptions[i]) {
							descriptions[j] = descriptions[i];
							j++;
						}
					}
					descriptions.length = j;
				}

				switch (descriptions.length) {
					case 1:
					return descriptions[0];

					case 2:
					return descriptions[0] + " or " + descriptions[1];

					default:
					return descriptions.slice(0, -1).join(", ")
					+ ", or "
					+ descriptions[descriptions.length - 1];
				}
			}

			function describeFound(found) {
				return found ? "\"" + literalEscape(found) + "\"" : "end of input";
			}

			return "Expected " + describeExpected(expected) + " but " + describeFound(found) + " found.";
		};

		function peg$parse(input, options) {
			options = options !== void 0 ? options : {};

			var peg$FAILED = {},

			peg$startRuleFunctions = { start: peg$parsestart },
			peg$startRuleFunction  = peg$parsestart,

			peg$c0 = "!",
			peg$c1 = peg$literalExpectation("!", false),
			peg$c2 = function(at, cmd) { return cmd; },
			peg$c3 = peg$otherExpectation("command"),
			peg$c4 = "help",
			peg$c5 = peg$literalExpectation("help", false),
			peg$c6 = function() { return new CliCmd(Cli.help, null); },
			peg$c7 = function(start_cmd) { return start_cmd; },
			peg$c8 = "stop",
			peg$c9 = peg$literalExpectation("stop", false),
			peg$c10 = function() { return new CliCmd(Cli.stop, null); },
			peg$c11 = "pause",
			peg$c12 = peg$literalExpectation("pause", false),
			peg$c13 = function() { return new CliCmd(Cli.pause, null); },
			peg$c14 = function(go_cmd) { return go_cmd; },
			peg$c15 = function(auto_cmd) { return auto_cmd; },
			peg$c16 = peg$otherExpectation("go command"),
			peg$c17 = "go",
			peg$c18 = peg$literalExpectation("go", false),
			peg$c19 = function(team) { return team; },
			peg$c20 = peg$otherExpectation("team"),
			peg$c21 = "red",
			peg$c22 = peg$literalExpectation("red", false),
			peg$c23 = function() { return new CliCmd(Cli.go, Team.RED); },
			peg$c24 = "blue",
			peg$c25 = peg$literalExpectation("blue", false),
			peg$c26 = function() { return new CliCmd(Cli.go, Team.BLUE); },
			peg$c27 = "spec",
			peg$c28 = peg$literalExpectation("spec", false),
			peg$c29 = function() { return new CliCmd(Cli.go, Team.SPEC); },
			peg$c30 = peg$otherExpectation("start command"),
			peg$c31 = "start",
			peg$c32 = peg$literalExpectation("start", false),
			peg$c33 = "restart",
			peg$c34 = peg$literalExpectation("restart", false),
			peg$c35 = function(cmd, stadium) {
				if (cmd === "start") {
					return new CliCmd(Cli.start, stadium);
				}
				else if (cmd === "restart") {
					return new CliCmd(Cli.restart, stadium);
				}
			},
			peg$c36 = peg$otherExpectation("id"),
			peg$c37 = /^[a-zA-Z]/,
			peg$c38 = peg$classExpectation([["a", "z"], ["A", "Z"]], false, false),
			peg$c39 = /^[0-9]/,
			peg$c40 = peg$classExpectation([["0", "9"]], false, false),
			peg$c41 = function(ids) { return capitalize(ids.flat().join("")); },
			peg$c42 = peg$otherExpectation("autostart command"),
			peg$c43 = "as",
			peg$c44 = peg$literalExpectation("as", false),
			peg$c45 = "on",
			peg$c46 = peg$literalExpectation("on", false),
			peg$c47 = function() { return new CliCmd(Cli.autostart, true); },
			peg$c48 = "off",
			peg$c49 = peg$literalExpectation("off", false),
			peg$c50 = function() { return new CliCmd(Cli.autostart, false); },
			peg$c51 = function(cmd) { return cmd; },
			peg$c52 = peg$otherExpectation("whitespace"),
			peg$c53 = /^[ \t\n\r]/,
			peg$c54 = peg$classExpectation([" ", "\t", "\n", "\r"], false, false),

			peg$currPos          = 0,
			peg$savedPos         = 0,
			peg$posDetailsCache  = [{ line: 1, column: 1 }],
			peg$maxFailPos       = 0,
			peg$maxFailExpected  = [],
			peg$silentFails      = 0,

			peg$result;

			if ("startRule" in options) {
				if (!(options.startRule in peg$startRuleFunctions)) {
					throw new Error("Can't start parsing from rule \"" + options.startRule + "\".");
				}

				peg$startRuleFunction = peg$startRuleFunctions[options.startRule];
			}

			function text() {
				return input.substring(peg$savedPos, peg$currPos);
			}

			function location() {
				return peg$computeLocation(peg$savedPos, peg$currPos);
			}

			function expected(description, location) {
				location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

				throw peg$buildStructuredError(
					[peg$otherExpectation(description)],
					input.substring(peg$savedPos, peg$currPos),
					location
				);
			}

			function error(message, location) {
				location = location !== void 0 ? location : peg$computeLocation(peg$savedPos, peg$currPos)

				throw peg$buildSimpleError(message, location);
			}

			function peg$literalExpectation(text, ignoreCase) {
				return { type: "literal", text: text, ignoreCase: ignoreCase };
			}

			function peg$classExpectation(parts, inverted, ignoreCase) {
				return { type: "class", parts: parts, inverted: inverted, ignoreCase: ignoreCase };
			}

			function peg$anyExpectation() {
				return { type: "any" };
			}

			function peg$endExpectation() {
				return { type: "end" };
			}

			function peg$otherExpectation(description) {
				return { type: "other", description: description };
			}

			function peg$computePosDetails(pos) {
				var details = peg$posDetailsCache[pos], p;

				if (details) {
					return details;
				} else {
					p = pos - 1;
					while (!peg$posDetailsCache[p]) {
						p--;
					}

					details = peg$posDetailsCache[p];
					details = {
						line:   details.line,
						column: details.column
					};

					while (p < pos) {
						if (input.charCodeAt(p) === 10) {
							details.line++;
							details.column = 1;
						} else {
							details.column++;
						}

						p++;
					}

					peg$posDetailsCache[pos] = details;
					return details;
				}
			}

			function peg$computeLocation(startPos, endPos) {
				var startPosDetails = peg$computePosDetails(startPos),
				endPosDetails   = peg$computePosDetails(endPos);

				return {
					start: {
						offset: startPos,
						line:   startPosDetails.line,
						column: startPosDetails.column
					},
					end: {
						offset: endPos,
						line:   endPosDetails.line,
						column: endPosDetails.column
					}
				};
			}

			function peg$fail(expected) {
				if (peg$currPos < peg$maxFailPos) { return; }

				if (peg$currPos > peg$maxFailPos) {
					peg$maxFailPos = peg$currPos;
					peg$maxFailExpected = [];
				}

				peg$maxFailExpected.push(expected);
			}

			function peg$buildSimpleError(message, location) {
				return new peg$SyntaxError(message, null, null, location);
			}

			function peg$buildStructuredError(expected, found, location) {
				return new peg$SyntaxError(
					peg$SyntaxError.buildMessage(expected, found),
					expected,
					found,
					location
				);
			}

			function peg$parsestart() {
				var s0;

				s0 = peg$parseline();

				return s0;
			}

			function peg$parseline() {
				var s0, s1, s2, s3, s4;

				s0 = peg$currPos;
				if (input.charCodeAt(peg$currPos) === 33) {
					s1 = peg$c0;
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c1); }
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parse_();
					if (s2 !== peg$FAILED) {
						s3 = peg$parsecommand();
						if (s3 !== peg$FAILED) {
							s4 = peg$parse_();
							if (s4 !== peg$FAILED) {
								peg$savedPos = s0;
								s1 = peg$c2(s1, s3);
								s0 = s1;
							} else {
								peg$currPos = s0;
								s0 = peg$FAILED;
							}
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}

				return s0;
			}

			function peg$parsecommand() {
				var s0, s1;

				peg$silentFails++;
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 4) === peg$c4) {
					s1 = peg$c4;
					peg$currPos += 4;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c5); }
				}
				if (s1 !== peg$FAILED) {
					peg$savedPos = s0;
					s1 = peg$c6();
				}
				s0 = s1;
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					s1 = peg$parsestart_cmd();
					if (s1 !== peg$FAILED) {
						peg$savedPos = s0;
						s1 = peg$c7(s1);
					}
					s0 = s1;
					if (s0 === peg$FAILED) {
						s0 = peg$currPos;
						if (input.substr(peg$currPos, 4) === peg$c8) {
							s1 = peg$c8;
							peg$currPos += 4;
						} else {
							s1 = peg$FAILED;
							if (peg$silentFails === 0) { peg$fail(peg$c9); }
						}
						if (s1 !== peg$FAILED) {
							peg$savedPos = s0;
							s1 = peg$c10();
						}
						s0 = s1;
						if (s0 === peg$FAILED) {
							s0 = peg$currPos;
							if (input.substr(peg$currPos, 5) === peg$c11) {
								s1 = peg$c11;
								peg$currPos += 5;
							} else {
								s1 = peg$FAILED;
								if (peg$silentFails === 0) { peg$fail(peg$c12); }
							}
							if (s1 !== peg$FAILED) {
								peg$savedPos = s0;
								s1 = peg$c13();
							}
							s0 = s1;
							if (s0 === peg$FAILED) {
								s0 = peg$currPos;
								s1 = peg$parsego_cmd();
								if (s1 !== peg$FAILED) {
									peg$savedPos = s0;
									s1 = peg$c14(s1);
								}
								s0 = s1;
								if (s0 === peg$FAILED) {
									s0 = peg$currPos;
									s1 = peg$parseauto_cmd();
									if (s1 !== peg$FAILED) {
										peg$savedPos = s0;
										s1 = peg$c15(s1);
									}
									s0 = s1;
								}
							}
						}
					}
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c3); }
				}

				return s0;
			}

			function peg$parsego_cmd() {
				var s0, s1, s2, s3;

				peg$silentFails++;
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 2) === peg$c17) {
					s1 = peg$c17;
					peg$currPos += 2;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c18); }
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parse_();
					if (s2 !== peg$FAILED) {
						s3 = peg$parseteam();
						if (s3 !== peg$FAILED) {
							peg$savedPos = s0;
							s1 = peg$c19(s3);
							s0 = s1;
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c16); }
				}

				return s0;
			}

			function peg$parseteam() {
				var s0, s1;

				peg$silentFails++;
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 3) === peg$c21) {
					s1 = peg$c21;
					peg$currPos += 3;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c22); }
				}
				if (s1 !== peg$FAILED) {
					peg$savedPos = s0;
					s1 = peg$c23();
				}
				s0 = s1;
				if (s0 === peg$FAILED) {
					s0 = peg$currPos;
					if (input.substr(peg$currPos, 4) === peg$c24) {
						s1 = peg$c24;
						peg$currPos += 4;
					} else {
						s1 = peg$FAILED;
						if (peg$silentFails === 0) { peg$fail(peg$c25); }
					}
					if (s1 !== peg$FAILED) {
						peg$savedPos = s0;
						s1 = peg$c26();
					}
					s0 = s1;
					if (s0 === peg$FAILED) {
						s0 = peg$currPos;
						if (input.substr(peg$currPos, 4) === peg$c27) {
							s1 = peg$c27;
							peg$currPos += 4;
						} else {
							s1 = peg$FAILED;
							if (peg$silentFails === 0) { peg$fail(peg$c28); }
						}
						if (s1 !== peg$FAILED) {
							peg$savedPos = s0;
							s1 = peg$c29();
						}
						s0 = s1;
					}
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c20); }
				}

				return s0;
			}

			function peg$parsestart_cmd() {
				var s0, s1, s2, s3;

				peg$silentFails++;
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 5) === peg$c31) {
					s1 = peg$c31;
					peg$currPos += 5;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c32); }
				}
				if (s1 === peg$FAILED) {
					if (input.substr(peg$currPos, 7) === peg$c33) {
						s1 = peg$c33;
						peg$currPos += 7;
					} else {
						s1 = peg$FAILED;
						if (peg$silentFails === 0) { peg$fail(peg$c34); }
					}
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parse_();
					if (s2 !== peg$FAILED) {
						s3 = peg$parseid();
						if (s3 === peg$FAILED) {
							s3 = null;
						}
						if (s3 !== peg$FAILED) {
							peg$savedPos = s0;
							s1 = peg$c35(s1, s3);
							s0 = s1;
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c30); }
				}

				return s0;
			}

			function peg$parseid() {
				var s0, s1, s2, s3, s4;

				peg$silentFails++;
				s0 = peg$currPos;
				s1 = peg$currPos;
				if (peg$c37.test(input.charAt(peg$currPos))) {
					s2 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s2 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c38); }
				}
				if (s2 !== peg$FAILED) {
					s3 = [];
					if (peg$c37.test(input.charAt(peg$currPos))) {
						s4 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s4 = peg$FAILED;
						if (peg$silentFails === 0) { peg$fail(peg$c38); }
					}
					if (s4 === peg$FAILED) {
						if (peg$c39.test(input.charAt(peg$currPos))) {
							s4 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) { peg$fail(peg$c40); }
						}
					}
					while (s4 !== peg$FAILED) {
						s3.push(s4);
						if (peg$c37.test(input.charAt(peg$currPos))) {
							s4 = input.charAt(peg$currPos);
							peg$currPos++;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) { peg$fail(peg$c38); }
						}
						if (s4 === peg$FAILED) {
							if (peg$c39.test(input.charAt(peg$currPos))) {
								s4 = input.charAt(peg$currPos);
								peg$currPos++;
							} else {
								s4 = peg$FAILED;
								if (peg$silentFails === 0) { peg$fail(peg$c40); }
							}
						}
					}
					if (s3 !== peg$FAILED) {
						s2 = [s2, s3];
						s1 = s2;
					} else {
						peg$currPos = s1;
						s1 = peg$FAILED;
					}
				} else {
					peg$currPos = s1;
					s1 = peg$FAILED;
				}
				if (s1 !== peg$FAILED) {
					peg$savedPos = s0;
					s1 = peg$c41(s1);
				}
				s0 = s1;
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c36); }
				}

				return s0;
			}

			function peg$parseauto_cmd() {
				var s0, s1, s2, s3, s4;

				peg$silentFails++;
				s0 = peg$currPos;
				if (input.substr(peg$currPos, 2) === peg$c43) {
					s1 = peg$c43;
					peg$currPos += 2;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c44); }
				}
				if (s1 !== peg$FAILED) {
					s2 = peg$parse_();
					if (s2 !== peg$FAILED) {
						s3 = peg$currPos;
						if (input.substr(peg$currPos, 2) === peg$c45) {
							s4 = peg$c45;
							peg$currPos += 2;
						} else {
							s4 = peg$FAILED;
							if (peg$silentFails === 0) { peg$fail(peg$c46); }
						}
						if (s4 !== peg$FAILED) {
							peg$savedPos = s3;
							s4 = peg$c47();
						}
						s3 = s4;
						if (s3 === peg$FAILED) {
							s3 = peg$currPos;
							if (input.substr(peg$currPos, 3) === peg$c48) {
								s4 = peg$c48;
								peg$currPos += 3;
							} else {
								s4 = peg$FAILED;
								if (peg$silentFails === 0) { peg$fail(peg$c49); }
							}
							if (s4 !== peg$FAILED) {
								peg$savedPos = s3;
								s4 = peg$c50();
							}
							s3 = s4;
						}
						if (s3 !== peg$FAILED) {
							peg$savedPos = s0;
							s1 = peg$c51(s3);
							s0 = s1;
						} else {
							peg$currPos = s0;
							s0 = peg$FAILED;
						}
					} else {
						peg$currPos = s0;
						s0 = peg$FAILED;
					}
				} else {
					peg$currPos = s0;
					s0 = peg$FAILED;
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c42); }
				}

				return s0;
			}

			function peg$parse_() {
				var s0, s1;

				peg$silentFails++;
				s0 = [];
				if (peg$c53.test(input.charAt(peg$currPos))) {
					s1 = input.charAt(peg$currPos);
					peg$currPos++;
				} else {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c54); }
				}
				while (s1 !== peg$FAILED) {
					s0.push(s1);
					if (peg$c53.test(input.charAt(peg$currPos))) {
						s1 = input.charAt(peg$currPos);
						peg$currPos++;
					} else {
						s1 = peg$FAILED;
						if (peg$silentFails === 0) { peg$fail(peg$c54); }
					}
				}
				peg$silentFails--;
				if (s0 === peg$FAILED) {
					s1 = peg$FAILED;
					if (peg$silentFails === 0) { peg$fail(peg$c52); }
				}

				return s0;
			}



			const capitalize = (s) => {
				if (typeof s !== 'string') return ''
				return s.charAt(0).toUpperCase() + s.slice(1)
			};



			peg$result = peg$startRuleFunction();

			if (peg$result !== peg$FAILED && peg$currPos === input.length) {
				return peg$result;
			} else {
				if (peg$result !== peg$FAILED && peg$currPos < input.length) {
					peg$fail(peg$endExpectation());
				}

				throw peg$buildStructuredError(
					peg$maxFailExpected,
					peg$maxFailPos < input.length ? input.charAt(peg$maxFailPos) : null,
					peg$maxFailPos < input.length
					? peg$computeLocation(peg$maxFailPos, peg$maxFailPos + 1)
					: peg$computeLocation(peg$maxFailPos, peg$maxFailPos)
				);
			}
		}

		return {
			SyntaxError: peg$SyntaxError,
			parse:       peg$parse
		};
	})();
}
