var debug = true;

var db = new localStorageDB("db", localStorage);;
var parser = Parser(db);
var dbVersion = 1; // update this var if LIWC dictionaries change!
parser.initialize(dbVersion);

var tracker = Tracker();

var lastCategoryNotice = "";
var lastNotificationTime = {};

var categories = [
  "posemo",
  "i",
  "femininity",
  "aggression",
  "honesty"
];

var zeroCatString = "";
for (var i=0; i<categories.length; i++) {
  zeroCatString += "0;";
}

var femRange = [0, 0];

var notifications = {
  "posemo" : [
    [ 0, 0.25, ["Try to look on the bright side.", "Stop being such a downer.", "Try to be more positive."]],
    [ 1, 0.82, ["Tone it down a bit, THEM doesn't sound so happy."]]
  ],
  "i" : [
    [ 1, 0.75, ["Stop talking about yourself so much.", "Focus on THEM a little more."]]
  ],
  "aggression" : [
    [ 0, 0.25, ["You are sounding like a pushover.", "Be more aggressive."]],
    [ 1, 0.82, ["Tone down the aggression."]]
  ],
  "honesty" : [
    [ 0, 0.25, ["What are you hiding? THEM is speaking much more honestly."]]
  ]
};


var automuteTimeout = 60 * 1000;
var sadNoticeTimeout = 60 * 1000;
var categoryNoticeTimeout = 45 * 1000;
var automuteNoticeTimeout = 30 * 1000;

var displayNoticeTimeout = 45 * 1000;
var conversationStartTime;

var localParticipant;
var otherParticipant = {}; // initialize to empty obj

// wait until hangout ready then load everything
if (gapi && gapi.hangout) {

  var initHangout = function(apiInitEvent) {
    if (apiInitEvent.isApiReady) {
      //prepareAppDOM();

      //console.log("hangout ready");

      // attach listeners
      gapi.hangout.data.onStateChanged.add(function(stateChangeEvent) {
        if (!debug) notify(stateChangeEvent);
      });

      updateParticipants();

      // init data vals
      gapi.hangout.data.setValue(localParticipant.id+"-volAvg;st;displayst", "0;0;0");
      gapi.hangout.data.setValue(localParticipant.id+"-smileState", "neutral");
      gapi.hangout.data.setValue(localParticipant.id+"-cats", zeroCatString);


      gapi.hangout.onParticipantsChanged.add(function(partChangeEvent) {
        updateParticipants();
      });
      gapi.hangout.av.effects.onFaceTrackingDataChanged.add(tracker.onFaceTrackingDataChanged);

      gapi.hangout.onApiReady.remove(initHangout);
    }
  };

  gapi.hangout.onApiReady.add(initHangout);
}

$(window).load(function() {
  //console.log('window load');
  startSpeech();
  updateParticipants();

  if (debug) {

    // extra stuff for getting video assets
    $('body').keypress(function(e) {
      var msg;
      if (e.which == 33) msg = notifications['posemo'][0][2][1];
      if (e.which == 34) msg = notifications['posemo'][0][2][2];
      if (e.which == 35) msg = notifications['i'][0][2][0];
      if (e.which == 36) msg = notifications['aggression'][0][2][0];
      if (e.which == 37) msg = notifications['aggression'][1][2][0];
      if (e.which == 38) msg = notifications['honesty'][0][2][0];
      if (e.which == 39) msg = "You've been auto-muted because you're talking too much.";
      if (e.which == 40) msg = notifications['aggression'][0][2][1];

      if (msg) {
        msg = msg.replace('THEM', 'Clare');
        gapi.hangout.layout.displayNotice(msg, false);
      }

    });
  }

  $('#debug_submit').click(function(e) {

    for (var k=0; k<2; k++) {
      var talk = parseInt($('input[name=talk_'+k+']').val(), 10)*1000;
      console.log(talk);

      if (talk) {
        if (k == 0 && localParticipant.id)  {
          gapi.hangout.data.setValue(localParticipant.id+"-volAvg;st;displayst", "0;"+String(talk)+";"+String(talk));
        } else if (otherParticipant.id) {
          gapi.hangout.data.setValue(otherParticipant.id+"-volAvg;st;displayst", "0;"+String(talk)+";"+String(talk));
        }

        talk = new Date(talk);
        console.log(talk);
        talk = talk.toLocaleTimeString();
        talk = talk.substring(talk.indexOf(':')+1, talk.indexOf(' '));
        console.log(talk);
        $('#talkTime'+k).text(talk);
      }
    }    

    for (var i=0; i<categories.length; i++) {
      var start = $('input[name='+categories[i]+'_0]').val();
      if (start) {
        console.log(categories[i], start);
        // set to start vals
        var pct = Math.round(clamp(start, 0, 1)*100) + "%";
        $('#category-'+categories[i]).width(pct);
      }
    }
  });
  setTimeout(function() {$('#debug').css('display', 'block');}, 2000);
});

function notify(ev) {

  // Update LIWC cats

  var localCatVals = gapi.hangout.data.getValue(localParticipant.id+"-cats");
  if(!localCatVals) {
    localCatVals = zeroCatString;
  }
  localCatVals = localCatVals.split(';');
  var otherCatVals = gapi.hangout.data.getValue(otherParticipant.id+"-cats");
  if(!otherCatVals) {
    otherCatVals = zeroCatString;
  }
  otherCatVals = otherCatVals.split(';');

  for(var i = 0; i < categories.length; i++) {
    var category = categories[i];

    var balance = 0.5;

    var localScore = localCatVals[i] ? parseFloat(localCatVals[i]) : 0;
    var otherScore = otherCatVals[i] ? parseFloat(otherCatVals[i]) : 0;

    // do range mapping for fem
    if (category == "femininity") {
      femRange[0] = Math.min(localScore, otherScore, femRange[0]);
      femRange[1] = Math.max(localScore, otherScore, femRange[1]);
      ////console.log(femRange);
      localScore = clamp(map(localScore, femRange[0], femRange[1], 0, 1), 0, 1);
      otherScore = clamp(map(otherScore, femRange[0], femRange[1], 0, 1), 0, 1);
      ////console.log(localScore, otherScore);
    }

    var totalScore = localScore+otherScore;
    
    if(totalScore > 0) {
      balance = localScore / totalScore;
    }

    var pct = Math.round(clamp(balance, 0, 1)*100) + "%";
    ////console.log(pct);
    $('#category-'+category).width(pct);

    var notes = notifications[category];
    var now = new Date().getTime();
    if(notes) {
      for (var j=0; j<notes.length; j++) {
        if ((!notes[j][0] && balance < parseFloat(notes[j][1])) // lt
          || (notes[j][0] && balance > parseFloat(notes[j][1]))) { // gt
          ////console.log(notes[j][2] + " " + !notes[j][0]+" "+parseFloat(notes[j][1])+" "+balance);
          ////console.log("DISPLAY "+notes[j][2]);
          var msgs = notes[j][2];
          var randMsg = msgs[Math.floor(Math.random() * msgs.length)];

          if (category !== lastCategoryNotice) {
            if (otherParticipant.person) randMsg = randMsg.replace('THEM',  formatFirstName(otherParticipant.person.displayName));
            if (displayNotice("category", randMsg, categoryNoticeTimeout)) {
              lastCategoryNotice = category;
            }
          }
          break;
        }  
      }
    } 
  }

  // Update smile
  if(otherParticipant.id) {
    var otherSmileState = gapi.hangout.data.getValue(otherParticipant.id+"-smileState");
    if(otherSmileState) {
      setSrc('#face1', "//lmccart-fixus.appspot.com/static/img/emoticon-other-" + otherSmileState + ".png");
      if(otherSmileState == "sad") {
        displayNotice("smile", formatFirstName(otherParticipant.person.displayName)+" is looking a bit sad.", sadNoticeTimeout);
      }
    }
  }
}

function displayNotice(type, msg, delay) {
  var needToTrigger = false;
  var now = new Date().getTime();
  if(conversationStartTime && now - conversationStartTime > displayNoticeTimeout) {
    if(lastNotificationTime[type]) {
      var prev = lastNotificationTime[type];
      var diff = now - prev;
      if(diff > delay) {
        needToTrigger = true;
      }
    } else {
      needToTrigger = true;
    }
    if(needToTrigger) {
      lastNotificationTime[type] = now;
      gapi.hangout.layout.displayNotice(msg, false);
    }
  }
  return needToTrigger;
}

function updateParticipants() {

  //console.log('update participants');

  // get participants
  localParticipant = gapi.hangout.getLocalParticipant();
  //console.log(localParticipant);
  participants = gapi.hangout.getParticipants();

  //console.log("participants updated: " + participants.length);

  for(i in participants) {
    participant = participants[i];
    //console.log("updating avatar " + i);
    //console.log(participant);
    if(participant != localParticipant) {
      otherParticipant = participant;
    }
  }

  // update avatars
  setSrc("#avatar0", localParticipant.person.image.url);
  if(otherParticipant.person) {
    setSrc("#avatar1", otherParticipant.person.image.url);
    conversationStartTime = new Date().getTime();
  }
}


// Handle incoming messages and distribute to appropriate functions.
function handleMessage(msg) {
  //console.log(msg);

  if (msg.type == 'stats') {
    var catString = '';
    for(var i = 0; i < categories.length; i++) {
      //console.log(localParticipant.id+"-"+categories[i]);
      catString += String(msg[categories[i]])+';';
    }
    gapi.hangout.data.setValue(localParticipant.id+"-cats", catString);
  }
}


function Hysteresis() {
  var lastTime = 0;
  var lastValue = false;
  var curValue = false;

  this.risingDelay = 250;
  this.fallingDelay = 1500;
  this.ontrigger = function(){};
  this.onuntrigger = function(){};

  this.update = function(value) {
    var curTime = Date.now();
    if(value != curValue) {
      if(value != lastValue) {
        lastTime = curTime;
      }
      var delay = value ? this.risingDelay : this.fallingDelay;
      if(curTime - lastTime >= delay) {
        if(value) {
          this.ontrigger();
        } else {
          this.onuntrigger();
        }
        curValue = value;
      }
    }
    lastValue = value;
  }
  this.getState = function() {
    return curValue;
  }
}

// helper functions
function map(x, inmin, inmax, outmin, outmax) {
  if (inmax == inmin) return 0;
  return ((x-inmin) / (inmax-inmin)) * (outmax-outmin) + outmin;
}

function manualInputSubmit() {
  parser.parseLine(document.getElementById('manualInput').value)
}

function unnormalize(point, ctx) {
  result = new Object();
  result.x = map(point.x, -.5, +.5, 0, ctx.canvas.width);
  result.y = map(point.y, -.5, +.5, 0, ctx.canvas.height);
  return result;
}

function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

function distance(a, b) {
  return length({x: b.x - a.x, y: b.y - a.y});
}

function average(a, b) {
  result = new Object();
  result.x = (a.x + b.x) / 2;
  result.y = (a.y + b.y) / 2;
  return result;
}

function clamp(x, low, high) {
  return Math.max(low, Math.min(high, x));
}



// it looks like jquery resets the src even when it's the same as before
// so we check before setting to avoid that
function setSrc(id, src) {
  if($(id).attr('src') !== src) {
    $(id).attr('src', src);
  }
}

function formatFirstName(str) {
    str = str.split(' ')[0]
    return str.charAt(0).toUpperCase() + str.slice(1);
}







