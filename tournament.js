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
for (var key in localStorage){
    if (tournamentNames.indexOf(key) === -1) {
        tournamentNames.push(key);
    }
}


var vue_data = {
    tournamentNames: tournamentNames,
    name: URI_KEY,
    banner: "https://sortmatch.ca/banner.jpg",
    ranking: new glicko2.Glicko2(),
    started: new Date(),
    pageLoad: new Date(),
    competitors: [],
    countdown: 0,
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
        } else if (typeof v === "object" && v.__rating !== undefined) {
            rating = vue_data.ranking.makePlayer();
            for (var k in v) rating[k] = v[k];
            return rating;
        } else if (typeof v === "object" && v.jsonid !== undefined) {
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
        matchResolve(match, result) {
            match.result = result;
            match.finished = new Date();
            match.favored.matched = false;
            match.unfavored.matched = false;
            regenerateRatings();
            var assigned = vue.competitors.filter(function(competitor) {
                return competitor.matches.filter(function(match) {
                    return match.finished === null;
                }).length !== 0;
            });
            if (assigned.length <= 1) {
                planMatches();
            }
            tournamentSave();
        },
        matchRevert(match) {
            if (confirm("Do you want to undo this match's result and place it back into the pool of pending matches?")) {
                match.result = null;
                match.finished = null;
                regenerateRatings();
            }
        },
        tournamentAdd() {
            var name = (prompt("Tournament title?") || "").trim();
            if (name) {
                location.href = "/?" + encodeURIComponent(name);
            }
        },
        tournamentExport() {
            tournamentSave();
            parsed = jsonToObject(localStorage[URI_KEY]);
            parsed.competitors.forEach(function(competitor, index) {
                delete competitor.ranking;
            });
            saveAs(
                new Blob(
                    [objectToJSON(parsed)],
                    {type: "application/json;charset=utf-8"}
                ),
                URI_KEY + " (" + (new Date()).toISOString().split(".")[0].replace(/[^0-9]/g, "-") + ").json"
            );
        },
        tournamentDelete() {
            if (confirm("Your tournament will not be recoverable. Are you sure you're okay with deleting this tournament?")) {
                vue.tournamentExport();
                delete localStorage[URI_KEY];
                location.href = "/";
            }
        },
        bannerChange() {
            var url = (prompt("New banner URL?") || "").trim();
            if (!url || url.startsWith("http://") || url.startsWith("https://")) {
                vue.banner = url;
                tournamentSave();
            } else {
                alert("Banner URLs must start with `https://` or `http://` or be blank.");
            }
        },
        competitorAdd() {
            var name = (prompt("Competitor's name?") || "").trim();
            if (!name) {
            } else if (vue.competitors.filter(function(competitor) { return competitor.name == name; }).length !== 0) {
                console.log("Duplicate name provided.");
            } else {
                var initialRating = parseInt(prompt("Competitor's initial rating? (10-20)", "15") * 100) || vue.ranking._default_rating;
                initialRating = Math.max(1000, Math.min(2000, initialRating));
                vue.competitors.push({
                    name: name,
                    initialRating: initialRating,
                    ranking: vue.ranking.makePlayer(initialRating, vue.ranking._default_rd, vue.ranking._default_vol),
                    matches: [],
                    matched: false
                });
                planMatches();
                tournamentSave();
            }
        }
    }
});


function tournamentSave(obj) {
    localStorage[URI_KEY] = objectToJSON({
        started: vue.started,
        competitors: vue.competitors,
        matches: vue.matches,
        paused: vue.paused,
        banner: vue.banner
    });
}
function tournamentLoad() {
    parsed = jsonToObject(localStorage[URI_KEY]);
    for (var k in parsed) {
        vue_data[k] = parsed[k];
    }
    regenerateRatings();
}
if (localStorage[URI_KEY]) {
    tournamentLoad();
}


function suitability(considering, competitor) {
    var rating_difference = Math.abs(considering.ranking.getRating() - competitor.ranking.getRating());
    var average_matches_global = vue.matches.length * 2 / vue.competitors.length;
    var average_matches_local = Math.min(considering.matches.length, competitor.matches.length);
    var recently_matched_penalties = [0];
    competitor.matches.slice(-7).reverse().map(function(match, index) {
        if (match.favored === considering && match.unfavored === competitor || match.favored === competitor && match.unfavored === considering) {
            recently_matched_penalties.push(300 / (index + 1));
        }
    });
    considering.matches.slice(-7).reverse().map(function(match, index) {
        if (match.favored === considering && match.unfavored === competitor || match.favored === competitor && match.unfavored === considering) {
            recently_matched_penalties.push(300 / (index + 1));
        }
    });
    var recently_matched_penalty = Math.max.apply(null, recently_matched_penalties);
    result = (rating_difference) * ((average_matches_local + 1) / (average_matches_global + 1.001)) + recently_matched_penalty;
    return result;
}


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


var planMatchesTimeout = null;
function planMatches() {

    // Just bail if we're paused
    if (vue.paused) {
        return;
    }

    // Decide when to next call planMatches
    clearTimeout(planMatchesTimeout);
    var durations = vue.matches.map(function(match) { return (match.finished ? match.finished : new Date()) - match.start });
    if (durations.length) {
        var sum = durations.reduce(function(a, b) { return a + b; });
        var avg = sum / durations.length;
        var delay = 30 + Math.pow(avg / 60000, 0.5) * 60;
    } else {
        var delay = 30;
    }
    vue.countdown = parseInt(delay);
    planMatchesTimeout = setTimeout(planMatches, delay * 1000);

    // Pair up available competitors
    var considered = [];
    while (true) {
        var unassigned = vue.competitors.filter(function(competitor) {
            return competitor.matches.filter(function(match) {
                return match.finished === null;
            }).length === 0;
        });
        var viable = unassigned.filter(function(competitor) {
            return considered.indexOf(competitor) === -1;
        });
        if (viable.length < 2) {
            break;
        }

        var considering = viable.sort(function(a, b) {
            return a.matches.length - b.matches.length + (Math.random() - 0.5) * 2;
        })[0];
        considered.push(considering);
        var excluded = considered.filter(function(x) { return true; });

        // Strict set of candidates that could ever possibly be considered
        var pairable = unassigned.filter(function(competitor) {
            return excluded.indexOf(competitor) === -1 && suitability(considering, competitor) < 200 + 1000 * Math.pow(unassigned.length / vue.competitors.length, 1.5);
        }).sort(function(a, b) {
            return suitability(considering, a) - suitability(considering, b) + (Math.random() - 0.5) * 50;
        });

        if (pairable.length) {
            var pairing = pairable[0];
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
        }
    }
}


// Plan matches immediately upon page load
planMatches();


// Decrement the vue countdown every second (is there a better way to implement a vue.js-compatible timer?)
setInterval(function() {
    vue.countdown = Math.max(0, vue.countdown - 1);
}, 1000);


// Start the page focused on the competitor add button
$("#competitor-add").focus();


// Prevent "#" links from changing the url hash
$(document).on("click", "a[href=#]", function(event) {
    event.preventDefault();
});


// If the tournament is named "Example Tournament", run the demo
if (vue.name == "Example Tournament" && !vue.competitors.length) {
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
            matched: false
        });
    }
    setTimeout(planMatches, 1200);
}


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
