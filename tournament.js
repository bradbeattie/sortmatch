var RESULT_FAVORED = 1;
var RESULT_TIE = 0.5;
var RESULT_UNFAVORED = 0;
var RESULT_ABANDONED = null;
var URI_KEY = decodeURIComponent(location.search.substring(1).split("&")[0]);


Vue.directive('highlight', function() {
    $(this.el).stop(true).animate({backgroundColor: "hsl(30, 100%, 50%)"}).animate({backgroundColor: "hsl(30, 100%, 75%)"}).animate({backgroundColor: "hsl(30, 0%, 90%)"}, 30000).animate({backgroundColor: "transparent"}, 60000);
});


Vue.filter('finished', function(matches, finished) {
    return matches.filter(function(match, index) {
        return match.finished && finished || !match.finished && !finished;
    });
})


Vue.filter('matchesCompleted', function(competitor) {
    return competitor.matches.filter(function(match, index) {
        return match.finished && match.result !== RESULT_ABANDONED;
    }).length;
})


Vue.filter('favoredOrder', function(matches) {
    return matches.sort(function(a, b) {
        return b.favored.ranking.getRating() - a.favored.ranking.getRating();
    });
})


Vue.filter('round', function(value, decimals) {
    if (!value) {
        value = 0;
    }
    if (!decimals) {
        decimals = 0;
    }
    value = Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
    return value.toFixed(decimals);
});


var tournamentNames = ["Example Tournament"];
for (var key in localStorage) {
    if (localStorage.hasOwnProperty(key) && tournamentNames.indexOf(key) === -1) {
        tournamentNames.push(key);
    }
}


var vue_data = {
    lang: locale,
    tournamentNames: tournamentNames,
    name: URI_KEY,
    banner: null,
    ranking: new glicko2.Glicko2(),
    started: new Date(),
    pageLoad: new Date(),
    competitors: [],
    countdown: 0,
    countdownActive: false,
    matches: [],
    paused: false,
    RESULT_FAVORED: RESULT_FAVORED,
    RESULT_TIE: RESULT_TIE,
    RESULT_UNFAVORED: RESULT_UNFAVORED,
    RESULT_ABANDONED: RESULT_ABANDONED
};


// Save and load
function objectToJSON(obj) {
    var replacerCache = [];
    return JSON.stringify(obj, function(key, value) {
        if (typeof value === 'object' && value !== null && value.hasOwnProperty("__rating")) {
            return null;
        }
        if (typeof value === 'object' && value !== null) {
            if (replacerCache.indexOf(value) !== -1) {
                return "jsonid:"+replacerCache.indexOf(value);
            }
            value.jsonid = replacerCache.length;
            replacerCache.push(value);
        }
        return value;
    });
}
function jsonToObject(json) {
    var reviverCache = {};
    var parsed = JSON.parse(json, function(k, v) {
        if (v === null) {
            return v;
        }

        if (typeof v === "object" && v.initialRating !== undefined) {
            v.ranking = vue_data.ranking.makePlayer();
        }

        if (typeof v === "object" && v.jsonid !== undefined) {
            reviverCache[v.jsonid] = v;
            delete v.jsonid;
        } else if (typeof v === "string" && v.endsWith("Z") && Date.parse(v)) {
            return new Date(Date.parse(v));
        }
        return v;
    });
    if (parsed) {
        function revive(obj) {
            for (var k in obj) {
                v = obj[k];
                if (typeof v === "object") {
                    revive(v);
                } else if (typeof v === "string" && v.startsWith("jsonid:")) {
                    obj[k] = reviverCache[v.split(":")[1]];
                }
            }
        }
        revive(parsed);
        return parsed;
    }
}


function tournamentSave() {
    localStorage[URI_KEY] = objectToJSON({
        started: vue.started,
        competitors: vue.competitors,
        matches: vue.matches,
        paused: vue.paused,
        banner: vue.banner
    });
}
if (localStorage[URI_KEY]) {
    parsed = jsonToObject(localStorage[URI_KEY]);
    for (var k in parsed) {
        vue_data[k] = parsed[k];
    }
}


var vue = new Vue({
    el: '#vue-app',
    data: vue_data,
    watch: {
        'paused': function (paused) {
            tournamentSave();
            if (!paused) {
                planMatches();
            }
        }
    },
    methods: {
        getPairable() {
            return pairable = vue.competitors.filter(function(competitor) {
                return !competitor.paused && competitor.matches.filter(function(match) {
                    return match.finished === null;
                }).length === 0;
            });
        },
        setCountdown() {
            var old_status = vue.countdownActive;
            vue.countdownActive = (vue.getPairable().length / vue.competitors.length > 0.6);

            // If countdownActive has been switched on, reset the countdown timer
            if (!old_status && vue.countdownActive) {
                var durations = vue.matches.map(function(match) {
                    return (match.finished ? match.finished : new Date()) - match.start
                });
                if (durations.length) {
                    var sum = durations.reduce(function(a, b) { return a + b; });
                    var avg = sum / durations.length;
                    var delay = 30 + Math.pow(avg / 60000, 0.5) * 60;
                } else {
                    var delay = 30;
                }
                vue.countdown = parseInt(delay);
            }
        },
        matchResolve(match, result) {
            match.result = result;
            match.finished = new Date();
            match.favored.matched = false;
            match.unfavored.matched = false;
            regenerateRatings();
            if (vue.getPairable().length >= (vue.competitors.length - 1)) {
                planMatches();
            } else {
                vue.setCountdown();
                tournamentSave();
            }
        },
        matchRevert(match) {
            if (confirm(vue.lang.matchesRevertPrompt)) {
                match.result = null;
                match.finished = null;
                regenerateRatings();
            }
        },
        matchDeleteAll() {
            vue.competitors.forEach(function(competitor, index) {
                competitor.matches = []
                competitor.matched = false;
            });
            vue.matches = [];
            planMatches();
        },
        tournamentAdd() {
            var name = (prompt(vue.lang.tournamentTitlePrompt) || "").trim();
            if (name) {
                location.href = "/?" + encodeURIComponent(name);
            }
        },
        tournamentExport() {
            tournamentSave();
            saveAs(
                new Blob(
                    [localStorage[URI_KEY]],
                    {type: "application/json;charset=utf-8"}
                ),
                URI_KEY + " (" + (new Date()).toISOString().split(".")[0].replace(/[^0-9]/g, "-") + ").json"
            );
        },
        tournamentDelete() {
            if (confirm(vue.lang.tournamentDeleteConfirm)) {
                delete localStorage[URI_KEY];
                location.href = "/";
            }
        },
        bannerChange() {
            var url = (prompt(vue.lang.tournamentBannerPrompt) || "").trim();
            if (!url || url.startsWith("http://") || url.startsWith("https://")) {
                vue.banner = url;
                tournamentSave();
            } else {
                alert(vue.lang.tournamentBannerWhine);
            }
        },
        competitorAdd(name) {
            if (!name) {
                name = (prompt(vue.lang.competitorNamePrompt) || "").trim();
            }
            if (!name) {
            } else if (vue.competitors.filter(function(competitor) { return competitor.name == name; }).length !== 0) {
                alert(vue.lang.competitorNameWhine);
            } else {
                vue.competitors.push({
                    name: name,
                    initialRating: vue.ranking._default_rating,
                    ranking: vue.ranking.makePlayer(vue.ranking._default_rating, vue.ranking._default_rd, vue.ranking._default_vol),
                    matches: [],
                    matched: false,
                    paused: false
                });
                planMatches();
                tournamentSave();
            }
        },
        competitorAddMultiple() {
            $("#competitor-add-multiple textarea").val().trim().split("\n").forEach(function(name, index) {
                if (name) {
                    vue.competitorAdd(name);
                }
            });
            $("#competitor-add-multiple").modal("hide");
        },
        competitorPause(competitor) {
            competitor.paused = !competitor.paused;
            tournamentSave();
        },
        competitorInitialRatingChange(competitor) {
            var initialRating = parseInt(prompt(vue.lang.competitorRatingPrompt, competitor.initialRating / 100) * 100) || competitor.initialRating;
            competitor.initialRating = Math.max(500, Math.min(2000, initialRating));
            regenerateRatings();
            tournamentSave();
        },
        competitorNameChange(competitor) {
            var name = (prompt(vue.lang.competitorNamePrompt) || "").trim();
            if (!name) {
            } else if (vue.competitors.filter(function(competitor) { return competitor.name == name; }).length !== 0) {
                alert(vue.lang.competitorNameWhine);
            } else {
                competitor.name = name;
                tournamentSave();
            }
        }
    }
});

/* Using the initially provided ratings, follow https://github.com/mmai/glicko2js#when-to-update-rankings
 * and regenerate each player's new rating from the start with the results provided thus far. */
function regenerateRatings() {
    vue.ranking = new glicko2.Glicko2();
    vue.competitors.forEach(function(competitor, index) {
        competitor.ranking = vue.ranking.makePlayer(competitor.initialRating);
    });
    var matches = [];
    vue.matches.forEach(function(match, index) {
        if (match.finished && match.result !== RESULT_ABANDONED) {
            matches.push([
                match.favored.ranking,
                match.unfavored.ranking,
                match.result
            ]);
        }
    });
    vue.ranking.updateRatings(matches);
}


function planMatches() {

    // Just bail if we're paused
    if (vue.paused) {
        return;
    }

    // Pair up available competitors
    var any_planned = false;
    while (true) {

        // Filter down on active candidates without pending matches
        var pairable = vue.competitors.filter(function(competitor) {
            return !competitor.paused && competitor.matches.filter(function(match) {
                return match.finished === null;
            }).length === 0;
        });
        if (pairable.length < 2) {
            break;
        }

        // Filter viable to least matches, and select the one with the highest score
        var fewest_matches = Math.min.apply(
            null,
            pairable.map(function(competitor, index) {
                return competitor.matches.length;
            })
        );
        var competitors_with_fewest_matches = pairable.filter(function(competitor) {
            return competitor.matches.length == fewest_matches
        });
        var considering = competitors_with_fewest_matches.sort(function(a, b) {
            return b.ranking.getRating() - a.ranking.getRating() + (Math.random() - 0.5) * 0.01 // Random for tie breakers
        })[0];

        // Pair with the viable candidate with the closest rating
        var pairing = pairable.filter(function(competitor) {
            return competitor !== considering
        }).sort(function(a, b) {
            return Math.abs(a.ranking.getRating() - considering.ranking.getRating())
                 - Math.abs(b.ranking.getRating() - considering.ranking.getRating())
                 + (Math.random() - 0.5) * 0.01; // Random for tie breakers
        })[0];

        // Now that we have a pair, create a match
        var considering_is_greater = considering.ranking.getRating() > pairing.ranking.getRating();
        var match = {
            favored: considering_is_greater ? considering : pairing,
            unfavored: considering_is_greater ? pairing : considering,
            start: new Date(),
            result: null,
            finished: null
        };
        considering.matches.push(match);
        considering.matched = true;
        pairing.matches.push(match);
        pairing.matched = true;
        vue.matches.push(match);
        any_planned = true;
    }

    if (any_planned) {
        tournamentSave();
        vue.setCountdown();
    }
}


// Plan matches immediately upon page load
regenerateRatings();
planMatches();


// Decrement the vue countdown every second (is there a better way to implement a vue.js-compatible timer?)
setInterval(function() {
    if (!vue.paused && vue.countdownActive) {
        vue.countdown = Math.max(0, vue.countdown - 1);
        if (vue.countdown < 1) {
            planMatches();
        }
    }
}, 1000);


// If the tournament is named "Example Tournament", run the demo
if (vue.name == "Example Tournament" && !vue.competitors.length) {
    vue.banner = "https://sortmatch.ca/banner.jpg";
    var competitors = {
        "Montreal Canadiens": 110,
        "Tampa Bay Lightning" :108,
        "Detroit Red Wings": 100,
        "New York Rangers": 113,
        "Washington Capitals": 101,
        "New York Islanders": 101,
        "Ottawa Senators": 99,
        "Pittsburgh Penguins": 98,
        "St. Louis Blues": 109,
        "Nashville Predators": 104,
        "Chicago Blackhawks": 102,
        "Anaheim Ducks": 109,
        "Vancouver Canucks": 101,
        "Calgary Flames": 97,
        "Minnesota Wild": 100,
        "Winnepeg Jets": 99,
    };
    for(var name in competitors) {
        var initialRating = Math.round(100 * (6 * (competitors[name] - 97) / (113 - 97) + 12));
        vue.competitors.push({
            name: name,
            initialRating: initialRating,
            ranking: vue.ranking.makePlayer(initialRating, vue.ranking._default_rd, vue.ranking._default_vol),
            matches: [],
            matched: false,
            paused: false
        });
    }
    setTimeout(planMatches, 1300);
}


// Start the page focused on the competitor add button
$("#competitor-add").focus();


// Prevent "#" links from changing the url hash
$(document).on("click", "a[href=#]", function(event) {
    event.preventDefault();
});


// Handle file uploads
function handleFileSelect(evt) {
    var files = evt.target.files;
    for (var i=0, f; f=files[i]; i++) {
        var reader = new FileReader();
        reader.onload = (function(theFile) {
            return function(e) {
                var name = (prompt("Under what name should "+theFile.name+" be saved?", theFile.name.split(" (2")[0]) || "").trim();
                if (name) {
                    localStorage[name] = e.target.result;
                    if (vue.tournamentNames.indexOf(name) === -1) {
                        vue.tournamentNames.push(name);
                    }
                }
            };
        })(f);

        // Read in the image file as a data URL.
        reader.readAsText(f);
    }
}
$("#files").on("change", handleFileSelect);


$("body").addClass(URI_KEY ? "detail" : "index");
