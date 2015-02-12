var through = require('through2');
var fs = require('fs');
var path = require('path');
var chokidar = require('chokidar');

module.exports = watchify;
module.exports.args = {
    cache: {}, packageCache: {}, fullPaths: true
};

function watchify (b, opts) {
    if (!opts) opts = {};
    var cache = b._options.cache;
    var pkgcache = b._options.packageCache;
    var changingDeps = {};
    var pending = false;
    
    b.on('dep', function (dep) {
        if (typeof dep.id === 'string') {
            cache[dep.id] = dep;
        }
        if (typeof dep.file === 'string') {
            watchFile(dep.file);
        }
    });
    
    b.on('file', function (file) {
        watchFile(file);
    });
    
    b.on('package', function (pkg) {
        watchFile(path.join(pkg.__dirname, 'package.json'));
    });
    
    b.on('reset', reset);
    reset();
    
    function reset () {
        var time = null;
        var bytes = 0;
        b.pipeline.get('record').on('end', function () {
            time = Date.now();
        });
        
        b.pipeline.get('wrap').push(through(write, end));
        function write (buf, enc, next) {
            bytes += buf.length;
            this.push(buf);
            next();
        }
        function end () {
            var delta = Date.now() - time;
            b.emit('time', delta);
            b.emit('bytes', bytes);
            b.emit('log', bytes + ' bytes written ('
                + (delta / 1000).toFixed(2) + ' seconds)'
            );
            this.push(null);
        }
    }
    
    var fwatchers = {};
    var fwatcherFiles = {};
    
    b.on('transform', function (tr, mfile) {
        tr.on('file', function (file) {
            watchDepFile(mfile, file);
        });
    });

    function watchFile (file) {
      fs.lstat(file, function(err, stats) {
          if (err || stats.isDirectory()) return;
          watchFile_(file);
      })
    }

    function watchFile_ (file) {
      fs.realpath(file, function(err, realfile) {
        if (err) return;
        if (!fwatchers[realfile]) fwatchers[realfile] = [];
        if (!fwatcherFiles[realfile]) fwatcherFiles[realfile] = [];
        if (fwatcherFiles[realfile].indexOf(realfile) >= 0) return;
        
        var w = chokidar.watch(realfile, {persistent: true});
        w.setMaxListeners(0);
        w.on('error', b.emit.bind(b, 'error'));
        w.on('change', function () {
            invalidate(realfile);
            invalidate(file);
        });
        fwatchers[realfile].push(w);
        fwatcherFiles[realfile].push(realfile);
      });
    }
    
    function watchDepFile(mfile, file) {
        fs.realpath(file, function(err, realmfile) {
            if (err) return;
            fs.realpath(file, function(err, realfile) {
                if (err) return;
                if (!fwatchers[realmfile]) fwatchers[realmfile] = [];
                if (!fwatcherFiles[realmfile]) fwatcherFiles[realmfile] = [];
                if (fwatcherFiles[realmfile].indexOf(realfile) >= 0) return;

                var w = chokidar.watch(realfile, {persistent: true});
                w.setMaxListeners(0);
                w.on('error', b.emit.bind(b, 'error'));
                w.on('change', function () {
                    invalidate(realmfile);
                    invalidate(mfile);
                });
                fwatchers[realmfile].push(w);
                fwatcherFiles[realmfile].push(realfile);
            })
        })
    }
    
    function invalidate (id) {
        if (cache) delete cache[id];
        if (fwatchers[id]) {
            fwatchers[id].forEach(function (w) {
                w.close();
            });
            delete fwatchers[id];
            delete fwatcherFiles[id];
        }
        changingDeps[id] = true
        
        // wait for the disk/editor to quiet down first:
        if (!pending) setTimeout(function () {
            pending = false;
            b.emit('update', Object.keys(changingDeps));
            changingDeps = {};
        
        }, opts.delay || 600);
        pending = true;
    }
    
    b.close = function () {
        Object.keys(fwatchers).forEach(function (id) {
            fwatchers[id].forEach(function (w) { w.close() });
        });
    };
    
    return b;
}
