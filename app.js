/*jshint node:true globalstrict:true*/
"use strict";

var qs = require('querystring'),
    url = require('url'),
    express = require('express'),
    everyauth = require('everyauth'),
    OAuth = require('oauth').OAuth,
    request = require('request'),
    RedisStore = require('connect-redis')(express);

var API_URI = 'https://api.dropbox.com/1',
    CONTENT_API_URI = 'https://api-content.dropbox.com/1';

var dropbox = new OAuth(API_URI + '/oauth/request_token',
                        API_URI + '/oauth/access_token',
                        process.env.DROPBOX_KEY,
                        process.env.DROPBOX_SECRET,
                        '1.0',
                        null,
                        'HMAC-SHA1');

var runkeeper = {
    client_id: process.env.RUNKEEPER_KEY,
    client_secret: process.env.RUNKEEPER_SECRET,
    auth_url: process.env.RUNKEEPER_AUTH_URL,
    access_token_url: process.env.RUNKEEPER_TOKEN_URL,
    redirect_uri: process.env.SERVER_URL + '/auth/runkeeper',
    api_domain: 'api.runkeeper.com'
};

runkeeper.request = function(request_details, callback) {
    request(request_details, function(error, response, body) {
        if (error) {
            return callback(error);
        }
        try {
            var data = JSON.parse(body);
            callback(null, data);
        } catch(err) {
            callback(err);
        }
    });
};

runkeeper.get = function(uri, media_type, access_token, callback) {
    this.request({
        method: 'GET',
        headers: {
            'Accept': media_type, // TODO: how to know?
            'Authorization': 'Bearer ' + access_token
        },
        uri: "https://" + this.api_domain + uri
    }, callback);
};

runkeeper.getAccessToken = function(authorization_code, callback) {

    var request_params = {
        grant_type: "authorization_code",
        code: authorization_code,
        client_id: this.client_id,
        client_secret: this.client_secret,
        redirect_uri: this.redirect_uri
    };

    var request_details = {
        method: "POST",
        headers: { 'content-type' : 'application/x-www-form-urlencoded' },
        uri: this.access_token_url,
        body: qs.stringify(request_params)
    };

    this.request(request_details, callback);
};

runkeeper.getAuthRedirect = function() {
    var query = {
        client_id: this.client_id,
        response_type: 'code',
        redirect_uri: this.redirect_uri
    };
    return this.auth_url + '?' + qs.stringify(query);
};

//everyauth.console.log = true;

everyauth.dropbox
    .myHostname(process.env.SERVER_URL)
    .consumerKey(process.env.DROPBOX_KEY)
    .consumerSecret(process.env.DROPBOX_SECRET)
    .findOrCreateUser( function (sess, accessToken, accessSecret, user) {
        // session based only, for now
        return user;
    })
    .redirectPath('/');

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
    console.log(req.session);
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

function requireRunKeeper(req,res,next) {
    var runkeeperAuth = req.session.auth && req.session.auth.runkeeper;
    if (runkeeperAuth) {
        req.runkeeper = runkeeperAuth;
        next();
    } else {
        res.send("RunKeeper needs authorizing first.", 403);
    }
}

app.get('/api/runkeeper/profile', requireRunKeeper, function(req, res, next){
  var uri = req.runkeeper.user.profile,
      accept = 'application/vnd.com.runkeeper.Profile+json',
      token = req.runkeeper.access_token;
  runkeeper.get(uri, accept, token, function(err,data) {
      if (err) {
          return next(err);
      }
      res.send(data);
  });
});

app.get('/api/runkeeper/user', requireRunKeeper, function(req, res, next){
  var uri = '/user',
      accept = 'application/vnd.com.runkeeper.User+json',
      token = req.runkeeper.access_token;
  runkeeper.get(uri, accept, token, function(err,data) {
      if (err) {
          return next(err);
      }
      res.send(data);
  });
});

app.get('/api/runkeeper/fitness-activities', requireRunKeeper, function(req, res, next) {
  var uri = req.runkeeper.user.fitness_activities,
      accept = 'application/vnd.com.runkeeper.FitnessActivityFeed+json',
      token = req.runkeeper.access_token;
  runkeeper.get(uri, accept, token, function(err,data) {
      if (err) {
          return next(err);
      }
      console.log(data);
      res.send(data);
  });
});

app.get(/^\/api\/runkeeper(.*)/, requireRunKeeper, function(req, res, next) {
  var uri = req.params[0],
      accept = req.query.media_type || 'application/json',
      token = req.runkeeper.access_token;
  if (uri && uri.length && uri[0] == '/') {
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

function requireDropbox(req,res,next) {
    var dropboxAuth = req.session.auth && req.session.auth.dropbox;
    if (dropboxAuth) {
        req.dropbox = dropboxAuth;
        next();
    } else {
        res.send("Dropbox needs authorizing first.", 403);
    }
}

app.get('/api/dropbox/put-test', requireDropbox, function(req,res){
    dropbox.put(CONTENT_API_URI + '/files_put/sandbox/' + 'test.txt',
        req.dropbox.accessToken,
        req.dropbox.accessTokenSecret,
        "I am a test file.",
        "text/plain",
        function(err, data, rsp) {
            if (err) {
                console.log(err);
                res.send('oauth client error',500);
            } else {
                res.send(JSON.parse(data));
            }
        });
});

app.get('/auth/:service/logout', function(req, res) {
    var service = req.params.service;
    console.log('attempting to remove %s', service);
    if (service in { 'runkeeper':1, 'dropbox': 1}) {
        if (req.session.auth && req.session.auth[service]) {
            delete req.session.auth[service];
        } else {
            console.log('%s service not logged in', service);
        }
    } else {
        console.log('%s not a valid service for logout', service);
    }
    res.redirect('/');
});

app.get('/auth/runkeeper', function(req,res,next){
    if (req.session.auth && req.session.auth.runkeeper) {
        res.redirect('/');
    } else if (req.query.code) {
        runkeeper.getAccessToken(req.query.code, function(err, data) {
            if (err) {
                return next(err);
            }
            console.log("got access_token %s", data);
            req.session.auth = req.session.auth || {};
            req.session.auth.runkeeper = data;
            // Get user resource information:
            var uri = '/user',
                accept = 'application/vnd.com.runkeeper.User+json';
            runkeeper.get(uri, accept, data.access_token, function(err, user) {
                if (err) {
                    delete req.session.auth.runkeeper;
                    return next(err);
                }
                req.session.auth.runkeeper.user = user;
                // get actual profile info
                var uri = user.profile,
                    accept = 'application/vnd.com.runkeeper.Profile+json';
                runkeeper.get(uri, accept, data.access_token, function(err, profile) {
                    if (err) {
                        delete req.session.auth.runkeeper;
                        return next(err);
                    }
                    req.session.auth.runkeeper.profile = profile;
                    res.redirect('/');
                });
            });
        });
    } else {
      res.redirect(runkeeper.getAuthRedirect());
    }
});

app.listen(process.env.PORT, function() {
    console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

