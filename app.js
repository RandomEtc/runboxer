/*jshint node:true globalstrict:true*/
"use strict";

var qs = require('querystring'),
    fs = require('fs'),
    url = require('url'),
    ejs = require('ejs'),
    queue = require('queue'),
    express = require('express'),
    everyauth = require('everyauth'),
    request = require('request'),
    RedisStore = require('connect-redis')(express),
    Dropbox = require('./lib/dropbox'),
    RunKeeper = require('./lib/runkeeper');

var template = ejs.compile(fs.readFileSync('views/kml.ejs', 'utf8'))

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
        dropboxAuth = req.session.auth && req.session.auth.dropbox;
    //console.log(req.session);
    console.log(runkeeperAuth, dropboxAuth);
    res.render('index', {
        locals: {
            title: 'RunBoxer',
            hasRunKeeper: Boolean(runkeeperAuth),
            runkeeper: runkeeperAuth,
            hasDropbox: Boolean(dropboxAuth),
            dropbox: dropboxAuth
        }
    });
});

// protect API
function requireAuth(name) {
    return function(req,res,next) {
        console.log('checking for %s auth', name)
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
app.get('/api/runkeeper/user', runkeeper.userRoute());
app.get('/api/runkeeper/fitness-activities', runkeeper.fitnessActivityFeedRoute());
app.get('/auth/runkeeper', runkeeper.authRoute());

app.get(/^\/api\/runkeeper(\/.*)/, function(req, res, next) {
  var uri = req.params[0],
      accept = req.query.media_type || 'application/json',
      token = req.runkeeper.access_token;
  if (uri && uri.length) {
      runkeeper.get(uri, accept, token, function(err,data) {
          if (err) {
              return next(err);
          }
          console.log(data);
          res.send(data);
      });
  } else {
      next();
  }
});

app.post('/api/runboxer/job', requireAuth('runkeeper'), requireAuth('dropbox'), function(req, res, next) {
    var uri = req.runkeeper.user.fitness_activities,
        accept = 'application/vnd.com.runkeeper.FitnessActivityFeed+json',
        token = req.runkeeper.access_token;
    runkeeper.get(uri, accept, token, function(err,feed) {
        if (err || !feed) {
            return next(err || 'Received empty feed - not sure why.');
        } else {
            var q = queue();
            feed.items.forEach(function(item) {
                var uri = item.uri,
                    accept = 'application/vnd.com.runkeeper.FitnessActivity+json';
                q.defer(runkeeper.get.bind(runkeeper, uri, accept, token));
            });
            q.await(function(error, results) {
                if (err || !results) {
                    return next(err || 'Received empty results - not sure why.');
                } else {
                    var data = {
                        name: 'Test Runboxer Export',
                        description: 'Test Runboxer Description',
                        items: []
                    }
                    results.forEach(function(item) {
                        data.items.push(item);
                    })
                    dropbox.filesPut('/test.kml', template(data), "application/vnd.google-earth.kml+xml", req.dropbox, function(err, data) {
                        if (err || !data) {
                            console.log(err);
                            res.send('oauth client error',500);
                        } else {
                            res.send(data); // TODO: render a success page
                        }
                    });
                }
            });
        }
    });
})

app.post('/api/dropbox/put-test', function(req,res){
    dropbox.filesPut('/test.txt', "I am a test file.", "text/plain", req.dropbox, function(err, data) {
        if (err) {
            console.log(err);
            res.send('oauth client error',500);
        } else {
            res.send(data);
        }
    });
});

app.listen(process.env.PORT, function() {
    console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

