/*jshint node:true globalstrict:true*/
"use strict";

var qs = require('querystring'),
    fs = require('fs'),
    url = require('url'),
    ejs = require('ejs'),
    queue = require('queue'),
    express = require('express'),
    everyauth = require('everyauth'),
    RedisStore = require('connect-redis')(express),
    Dropbox = require('./lib/dropbox'),
    RunKeeper = require('./lib/runkeeper');

var template = ejs.compile(fs.readFileSync('views/kml.ejs', 'utf8'));

var dropbox = new Dropbox({
    hostName: process.env.SERVER_URL,
    consumerKey: process.env.DROPBOX_KEY,
    consumerSecret: process.env.DROPBOX_SECRET,
    sandbox: true
});

var runkeeper = new RunKeeper({
    client_id: process.env.RUNKEEPER_KEY,
    client_secret: process.env.RUNKEEPER_SECRET,
    auth_url: process.env.RUNKEEPER_AUTH_URL,
    access_token_url: process.env.RUNKEEPER_TOKEN_URL,
    redirect_uri: process.env.SERVER_URL + '/auth/runkeeper',
    api_domain: 'api.runkeeper.com'
});

var app = express.createServer();

// Configuration

var redisUrl = url.parse(process.env.REDISTOGO_URL),
    redisOptions = {
        port: redisUrl.port,
        host: redisUrl.hostname,
        pass: redisUrl.auth && redisUrl.auth.split(":")[1] // just the password
    };

app.configure(function(){
    app.set('views', __dirname + '/views');
    app.set('view engine', 'ejs');
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser());
    app.use(express.session({ store: new RedisStore(redisOptions), secret: process.env.SESSION_SECRET }));
    app.use(everyauth.middleware());
    app.use(app.router);
    app.use(express['static'](__dirname + '/public'));
});

app.configure('development', function(){
    app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
    app.use(express.errorHandler());
});

// Routes

app.get('/', function(req,res){
    var runkeeperAuth = req.session.auth && req.session.auth.runkeeper,
        dropboxAuth = req.session.auth && req.session.auth.dropbox,
        hasAuth = (runkeeperAuth && dropboxAuth) ? true : false,
        compoundId = hasAuth ? runkeeperAuth.user.userID + '-' + dropboxAuth.user.uid : null;
    res.render('index', {
        locals: {
            title: 'RunBoxer',
            hasRunKeeper: Boolean(runkeeperAuth),
            runkeeper: runkeeperAuth,
            hasDropbox: Boolean(dropboxAuth),
            dropbox: dropboxAuth,
            jobQueued: compoundId && (compoundId in jobs)
        }
    });
});

// protect API
function requireAuth(name) {
    return function(req,res,next) {
        console.log('checking for %s auth', name);
        var serviceAuth = req.session.auth && req.session.auth[name];
        if (serviceAuth) {
            req[name] = serviceAuth;
            next();
        } else {
            res.send(name + " needs authorizing first.", 403);
        }
    };
}

app.all('/api/runkeeper/*', requireAuth('runkeeper'));
app.all('/api/dropbox/*', requireAuth('dropbox'));

app.get('/api/runkeeper/profile', runkeeper.profileRoute());
// app.get('/api/runkeeper/user', runkeeper.userRoute());
// app.get('/api/runkeeper/fitness-activities', runkeeper.fitnessActivityFeedRoute());
app.get('/auth/runkeeper', runkeeper.authRoute());

// app.get(/^\/api\/runkeeper(\/.*)/, function(req, res, next) {
//   var uri = req.params[0],
//       accept = req.query.media_type || 'application/json',
//       token = req.runkeeper.access_token;
//   if (uri && uri.length) {
//       runkeeper.get(uri, accept, token, function(err,data) {
//           if (err) {
//               return next(err);
//           }
//           console.log(data);
//           res.send(data);
//       });
//   } else {
//       next();
//   }
// });

var jobs = {};

function processJob(id) {
    var job = jobs[id],
        token = job.runkeeper.access_token,
        feedQueue = queue(1);
    function getNextFeed(uri){
        return function(callback){
            var accept = 'application/vnd.com.runkeeper.FitnessActivityFeed+json';
            runkeeper.get(uri, accept, token, function(err,feed) {
                if (feed && feed.next) {
                    console.log('queueing next feed for job %s', id);
                    feedQueue.defer(getNextFeed(feed.next));
                }
                callback(err,feed);
            });
        };
    }
    console.log('queueing first feed for job %s', id);
    feedQueue.defer(getNextFeed(job.runkeeper.user.fitness_activities))
        .await(function(err,feeds){
            if (err || !feeds || !feeds.length) {
                console.error('job %s failed to get activity feeds', id);
                // TODO: mark job as failed in queue?
                console.error((err && err.stack) || 'Received empty feeds - not sure why.');
                delete jobs[id];
            } else {
                if (!Array.isArray(feeds)) {
                    feeds = [ feeds ];
                }
                console.log('job %s got feeds', id);
                var q = queue(5),
                    size = feeds[0].size,
                    offset = 0;
                feeds.forEach(function(feed){
                    var adjust = offset;
                    feed.items.forEach(function(item,i) {
                        var uri = item.uri,
                            accept = 'application/vnd.com.runkeeper.FitnessActivity+json';
                        q.defer(function(callback){
                            console.log('job %s fetching %d of %d items', id, adjust+i, size)
                            runkeeper.get(uri, accept, token, callback);
                        });
                    });
                    offset += feed.items.length;
                });
                q.await(function(error, results) {
                    console.log('job %s got %d results', id, results.length);
                    if (err || !results) {
                        console.error('job %s failed to get activity item', id);
                        // TODO: mark job as failed in queue?
                        console.error((err && err.stack) || 'Received empty results - not sure why.');
                        delete jobs[id];
                    } else {
                        var data = {
                            name: 'Test Runboxer Export',
                            description: 'Test Runboxer Description',
                            items: results
                        };
                        dropbox.filesPut('/test.kml', template(data), "application/vnd.google-earth.kml+xml", job.dropbox, function(err, data) {
                            if (err || !data) {
                                console.error('Failed to put final KML into Dropbox');
                                console.error((err && err.stack) || 'Received empty response from Dropbox - not sure why.');
                            } else {
                                console.log('job %s complete', id);
                            }
                            delete jobs[id];
                        });
                    }
                });
            }
        });
}

app.post('/api/runboxer/job', requireAuth('runkeeper'), requireAuth('dropbox'), function(req, res, next) {
    var compoundId = req.runkeeper.user.userID + '-' + req.dropbox.user.uid;
    if (compoundId in jobs) {
        res.send(418);
    } else {
        jobs[compoundId] = { runkeeper: req.runkeeper, dropbox: req.dropbox, items: [] };
        res.redirect('/');
        // TODO: proper queue (kue?)
        processJob(compoundId);
    }
});

// app.post('/api/dropbox/put-test', function(req,res){
//     dropbox.filesPut('/test.txt', "I am a test file.", "text/plain", req.dropbox, function(err, data) {
//         if (err) {
//             console.log(err);
//             res.send('oauth client error',500);
//         } else {
//             res.send(data);
//         }
//     });
// });

app.listen(process.env.PORT, function() {
    console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

