var express = require('express'),
    session = require('express-session'),
    cookieParser = require('cookie-parser'),
    bodyParser = require('body-parser'),
    http = require('http'),
    ejs = require('ejs'),
    path = require('path'),
    spotifyClient = require('./lib/client'),
    debug = require('debug')('spotify-server');

//Don't stop this server if an exception goes uncaught
process.on('uncaughtException', function (err) {
    console.error((err.stack+''));
    console.error('Node trying not to exit...');
});

function pP(a) {
    return a.replace(/./g, "*");
}

function getLogin(req) {
    var o = {};
    if (req.session && req.session.username) {
	debug("found login in session");
	o.username = req.session.username;
	o.password = req.session.password;
    } else {
	if (req.cookies.username) {
	    debug("found login in cookie");
	    o.username = req.cookies.username;
	    o.password = req.cookies.password;
	}
    }
    return o;
}

var app = express();
app.set('port', 3000);
app.set('views', __dirname + '/views');
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.use(session({ secret: 'keyboard cat loves spotify'}));
app.use(bodyParser.text({ type: 'text/html' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

//Index
app.get('/', function(req, res){
    res.render('index');
});

app.get('/spotify-server/logout', function(req,res){
    req.session.destroy(function(){
	res.redirect('/');
    });
});

//Get login information
app.post('/spotify-server/login', function(req, res, next){
    var uname = req.body.username;
    var pw = req.body.password;

    if(req.session.loggedin && uname=='check'){
	res.send({success: 'success'});
	return;
    }

    if(!req.session.loggedin && uname=='check'){
	res.send({error: {message: "invalid login"}});
	return;
    }

    spotifyClient.newInstance(uname,pw).login()
	.on('error', function(e){
	    res.send({error: {message: "invalid login"}});
	})
	.on('success', function(data){
	    req.session.username = uname;
	    req.session.password = pw;
	    req.session.loggedin = true;
	    res.send({success: 'success'});
	});
});

//Retrieve PlayLists
app.get('/spotify-server/playlists', function(req, res){
    debug("/playlists");
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    spotifyClient.newInstance(o.username, o.password).getPlayLists()
	.on('playListsReady', function(playlists){
	    res.send({playlists: playlists});
	})
	.on('error', function(err){
	    res.send({error: err});
	});
});

//Retrieve tracks for a given PlayList
app.get('/spotify-server/playlist/:playlistid', function(req, res){
    var playlistid = req.params.playlistid;
    var uri = 'spotify:user:'+req.session.username+':playlist:'+playlistid;
    debug("/playlist/%s", playlistid);
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    spotifyClient.newInstance(o.username, o.password).getTracksByPlayListURI(uri)
	.on('tracksReady', function(tracks){
	    res.send({tracks: tracks});
	})
	.on('error', function(err){
	    res.send({error: err});
	});
});

//Retrieve a single track
app.get('/spotify-server/track/:trackURI', function(req, res){
    var uri = req.params.trackURI;
    debug("/track/%s", uri);
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    spotifyClient.newInstance(o.username, o.password).getTrackByTrackURI(uri)
	.on('trackReady', function(track){
	    res.send(track);
	})
	.on('error', function(err){
	    res.send({error: err});
	});
});

//Retreive album art for a given track
app.get('/spotify-server/album-art/:trackURI', function(req, res){
    var trackURI = req.params.trackURI;
    debug("/album-art/%s", trackURI);
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    spotifyClient.newInstance(o.username, o.password).getAlbumArtByTrackURI(trackURI)
	.on('albumArtReady'+trackURI, function(data){
	    res.send(data);
	})
	.on('error', function(err){
	    res.send({error: err});
	});
});

//Search (tracks only right now)
app.get('/spotify-server/search/:query', function(req,res){
    var query = req.params.query;
    debug("/search/%s", query);
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    spotifyClient.newInstance(o.username, o.password).search(query)
	.on('searchResultsReady', function(data){
	    res.send(data);
	})
	.on('searchResultsError', function(e){
	    res.send({error: 'searchResultsError'});
	})
});

//Play a track
app.get('/:trackId.mp3', function(req, res){
    var trackURI = req.params.trackId;
    debug("/%s", trackURI);
    var o = getLogin(req);
    debug("SID: %s, User: %s, Pass: %s", req.session.id, o.username, pP(o.password));
    //Just pass the response here because we need to stream to it
    spotifyClient.newInstance(o.username,o.password).playTrackByURI(trackURI, res);
});

var server = http.createServer(app);
server.listen(app.get('port'), function(){
    debug('Listening on port',app.get('port'));
});
