var express = require('express'),
    qs = require('querystring'),
    url = require('url'),
    rk = require('./support/runkeeper/lib/runkeeper'),
    RedisStore = require('connect-redis')(express);

var runKeeper = new rk.HealthGraph({
  client_id : process.env.RUNKEEPER_KEY,
  client_secret : process.env.RUNKEEPER_SECRET,
  auth_url : process.env.RUNKEEPER_AUTH_URL,
  access_token_url : process.env.RUNKEEPER_TOKEN_URL,
  redirect_uri : process.env.SERVER_URL + '/auth/runkeeper'
});

runKeeper.getAuthRedirect = function() {
  var query = {
    client_id: this.client_id,
    response_type: 'code',
    redirect_uri: this.redirect_uri
  }
  return this.auth_url + '?' + qs.stringify(query);
}

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
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes

app.get('/', function(req,res){
  res.render('index', {
    locals: {
      title: 'RunBoxer',
      hasRunKeeper: req.session.hasRunKeeper,
      hasDropbox: req.session.hasDropbox
    }
  });
});

app.get('/auth/runkeeper', function(req,res){
  if (req.session.hasRunKeeper) {
    res.redirect('/');
  } else if (req.query.code) {
    runKeeper.getNewToken(req.query.code, function(access_token) {
      console.log(access_token);
      req.session.hasRunKeeper = true;
      req.session.auth = req.session.auth || {};
      req.session.auth.runKeeper = { access_token: access_token };
      // Get user profile information
      runKeeper.access_token = access_token;
      runKeeper.profile(function(data) {
        req.session.auth.runKeeper.user = JSON.parse(data);
        console.log(req.session.auth.runKeeper.user);
        res.redirect('/')
      });
      runKeeper.access_token = null;
    })
  } else {
    res.redirect(runKeeper.getAuthRedirect());
  }
})

app.listen(process.env.PORT, function() {
  console.log("Express server listening on port %d in %s mode", app.address().port, app.settings.env);
});

