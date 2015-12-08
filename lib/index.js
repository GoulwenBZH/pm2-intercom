
var pm2    = require('pm2');
var async  = require('async');
var pkg    = require('../package.json');
var semver = require('semver');

/**
 * PM2 / Keymetrics probes
 */
var pmx    = require('pmx').initModule();
var Probe  = require('pmx').probe();

var inMsgMetter = Probe.meter({
  name : 'IN msg/sec'
});

var outMsgMetter = Probe.meter({
  name : 'OUT msg/sec'
});

var procNb = Probe.metric({
  name  : 'processes',
  value : function() {
    return process_list.length;
  }
});

var process_list = [];
var t_retrieval = null;

/**
 * Broadcast strategies
 */
var Strategies = {
  broadcast : function(packet) {
    async.forEachLimit(process_list, 3, function(proc, next) {
      sendDataToProcessId(proc.pm_id, packet);
    }, function(err) {
      if (err) console.error(err);
    });
  },
  roundrobin : function(packet) {
    async.forEachLimit(process_list, 3, function(proc, next) {
      sendDataToProcessId(proc.pm_id, packet);
    }, function(err) {
      if (err) console.error(err);
    });
  }
};

function sendDataToProcessId(proc_id, packet) {
  outMsgMetter.mark();
  pm2.sendDataToProcessId(proc_id, packet.raw, function(err, res) {
    if (err) console.error(err);
  });
};

/**
 * Strategy selection
 */
function intercom(bus) {
  bus.on('process:msg', function(packet) {
    inMsgMetter.mark();

    switch (packet.raw.strategy) {
      case 'broadcast':
      Strategies.broadcast(packet);
      case 'roundrobin':
      Strategies.roundrobin(packet);
      default:
      Strategies.broadcast(packet);
    }

  });
}

/**
 * WORKER: Retrieve and format app
 */
function cacheApps() {
  t_retrieval = setInterval(function() {
    pm2.list(function(err, list) {
      if (err) {
        console.error(err);
        return;
      }
      process_list = list.map(function(proc) {
        return {
          name : proc.name,
          pm_id : proc.pm_id
        };
      });
    });
  }, 2000);
}

/**
 * Main entry
 */
pm2.connect(function(err) {
  if (err)
    throw new Error(err);

  // PM2 version checking
  pm2.getVersion(function(err, data) {
    if (semver.gte("0.15.11", data) == false) {
      exit();
      throw new Error('This PM2 version is not compatible with %s!!', pkg.name);
    }
  });

  pm2.launchBus(function(err, bus) {
    if (err)
      throw new Error(err);

    console.log('[%s:%s] ready', pkg.name, pkg.version);

    cacheApps();
    intercom(bus);
  });
});

function exit() {
  pm2.disconnect();
  pm2.disconnectBus();
  clearInterval(t_retrieval);
}
/**
 * When PM2 try to kill app
 */
process.on('SIGINT', function() {
  exit();
  setTimeout(function() {
    process.exit(0);
  }, 200);
});
