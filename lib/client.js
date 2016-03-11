var EventEmitter = require('events').EventEmitter,
    spotify_util = require('../node_modules/spotify-web/lib/util.js'),
    schemas = require('../node_modules/spotify-web/lib/schemas.js'),
    https = require('https'),
    Spotify = require('spotify-web'),
    debug = require('debug')('spotify-client'),
    xml2js = require('xml2js');

//Override rootlist function to get all rootlists, not just published
Spotify.prototype.rootlist = function (user, from, length, fn) {
    // argument surgery
    if ('function' == typeof user) {
	fn = user;
	from = length = user = null;
    } else if ('function' == typeof from) {
	fn = from;
	from = length = null;
    } else if ('function' == typeof length) {
	fn = length;
	length = null;
    }
    if (null == user) user = this.username;
    if (null == from) from = 0;
    if (null == length) length = 100;

    //debug('rootlist(%j, %j, %j)', user, from, length);

    var self = this;
    var hm = 'hm://playlist/user/' + user + '/rootlist?from=' + from + '&length=' + length;
    var SelectedListContent = schemas.build('playlist4','SelectedListContent');

    this.sendProtobufRequest({
	header: {
	    method: 'GET',
	    uri: hm
	},
	responseSchema: SelectedListContent
    }, fn);
};
    
function SpotifyClient(username, password) {
    this.username = username;
    this.password = password;
    EventEmitter.call(this);
}

SpotifyClient.super_ = EventEmitter;
SpotifyClient.prototype = Object.create(EventEmitter.prototype, {
    constructor: {
	value: SpotifyClient,
	enumerable: false
    }
});

SpotifyClient.prototype.newInstance = function(username, password) {
    return new SpotifyClient(username, password);
};

SpotifyClient.prototype.login = function() {
    var self = this;
    Spotify.login(self.username, self.password, function(err, spotify){
	if(err){
	    self.emit('error', 'error');
	}
	else{
	    spotify.disconnect();
	    self.emit('success', 'success');
	}
    });
    return self;
};

SpotifyClient.prototype.getPlayLists = function() {
    var self = this;
    //    var spotifyLib = spotify;

    //Login
    debug("getting playlists");
    Spotify.login(self.username, self.password, function(err, s) {
	if(err) {
	    self.emit('error', err);
	}

	//Rootlist
	s.rootlist( self.username, function(err, rootlist) {
	    if(err) {
		self.emit('error', err);
	    }

	    var rootItems = rootlist.contents.items;
	    var rootItemsLength = rootItems.length;
	    var playlists = new Array();
      
	    rootItems.forEach(function(playlistObject, index){
		//Lookup playlist by uri
		//Issue #1: Only lookup items with a playlist uri
		if('playlist' == spotify_util.uriType(playlistObject.uri)){
		    s.playlist(playlistObject.uri, function(err, playlist) {
			if(err) 
			    self.emit('error', err);

			playlist.playlistURI = playlistObject.uri;
			playlists.push(playlist);

			if(playlists.length == rootItemsLength){
			    debug('Spotify disconnecting after playlists');
			    s.disconnect();
			    self.emit('playListsReady', playlists)
			}            
		    });                                           
		}
		else{
		    rootItemsLength--;
		}
	    });
	});
    });

    return self;  
};

SpotifyClient.prototype.getTracksByPlayListURI = function(uri) {
    var self = this;
    //var spotifyLib = spotify;

    //Login
    debug('Connecting to Spotify for playlist: '+uri);
    Spotify.login(self.username, self.password, function(err, s) {
	if(err) {
	    self.emit('error', err);
	}

	s.playlist(uri, function(err, playlist) {
	    if(err) {
		debug(err);
		self.emit('error', err);
	    }

	    var playlistItems = playlist.contents.items;
	    var tracks = [];
	    var playlist = [];

	    for (var i = 0, l = playlistItems.length; i < l; i++) {
		if ('track' == spotify_util.uriType(playlistItems[i].uri)) {
		    tracks.push(playlistItems[i]);
		}
	    }

	    tracks.forEach(function(trackObject, index){
		s.get(trackObject.uri, function(err, track){
		    if(err) {
			self.emit('error', err);
		    }

		    track.trackURI = trackObject.uri;
		    playlist.push(track);

		    if(playlist.length == tracks.length){
			debug('Spotify disconnecting after playlist: '+uri);
			s.disconnect();
			self.emit('tracksReady', playlist);
		    }
		});
	    });
	});
    });

    return self;
};

SpotifyClient.prototype.getTrackByTrackURI = function(uri){
    var self = this;
    debug('Connecting to Spotify for /track/'+uri);
    Spotify.login(self.username, self.password, function(err, s) {
	if(err) {
	    self.emit('error', err);
	}

	// first get a "Track" instance from the track URI
	s.get(uri, function(err, track) {
	    if(err) 
		self.emit('error', err);

	    debug('Spotify disconnecting after /track/: '+uri);
	    s.disconnect();
	    self.emit('trackReady', track);
	});
    });

    return self;
}

SpotifyClient.prototype.getAlbumArtByTrackURI = function(uri){
    var self = this;
    self.getOembedResponseByURI(uri).on('end'+uri, function(data){
	self.emit('albumArtReady'+uri,data);
    });
    return self;
};

SpotifyClient.prototype.getOembedResponseById = function(uriType,id){
    var self = this;
    var uri = spotify_util.id2uri(uriType, id);
    self.getOembedResponseByURI(uri).on('end'+uri, function(data){
	self.emit('end'+id, data);
    });
    return self;  
};

SpotifyClient.prototype.getOembedResponseByURI = function(uri){
    var self = this;

    debug('Connecting to Spotify OEMBED for: '+uri);
    options = {
	hostname: 'embed.spotify.com', 
	path: '/oembed/?url='+uri, 
	method: 'GET',
	headers:{
	    'User-Agent': 'node.js'
	}
    };  

    var jsonData = '';

    var req = https.request(options,function(res){    
	//RESPONSE
	res.setEncoding('utf8');
	res.on('data', function(chunk){
	    jsonData += chunk;
	});

	res.on('error', function(e){
	    debug('error:',e);
	});

	//RESPONSE END
	res.on('end', function(){
	    self.emit('end'+uri, {itemGID: uri, oembed: JSON.parse(jsonData)});
	});  
    });

    req.on('error', function(e){
	debug('Spotify OEMBED error after retrieving art for:'+uri+' error: '+e);
    });

    req.end();  

    return self;
}

SpotifyClient.prototype.playTrackByURI = function(uri, res){
    var self = this;

    debug('Connecting to Spotify for /'+uri);
    Spotify.login(self.username, self.password, function(err, s) {
	if(err) {
	    self.emit('error', err);
	}

	// first get a "Track" instance from the track URI
	s.get(uri, function(err, track) {
	    if(err) 
		self.emit('error', err);

	    debug('Streaming: %s - %s', track.artist[0].name, track.name);

	    // play() returns a readable stream of MP3 audio data
	    track.play()
		.pipe(res)
		.on('error', function(e){
		    debug('Error while piping stream to client:',e);
		    s.disconnect();
		})
		.on('unpipe', function() {
		    debug('Unpipe detected, disconnecting for /'+uri);
		    s.disconnect();
		})
		.on('finish', function() {
		    debug('Spotify disconnecting for /'+uri);
		    s.disconnect();
		});
	});
    });
}

SpotifyClient.prototype.search = function(query){
    var self = this;

    debug('Connecting to Spotify for /search/'+query);  
    Spotify.login(self.username, self.password, function(err, s) {
	if(err)
	    self.emit('error', err);

	s.search(query,function(err,xml) {
	    if(err)
		self.emit('error', err);

	    debug('Disconnecting from Spotify after /search/'+query)
	    s.disconnect();

	    var parser = new xml2js.Parser();
	    parser.on('end', function(data) {
		var parseResults = self.parseSearchResults(data);

		parseResults.on('parseSearchResultsComplete', function(data){
		    self.emit('searchResultsReady', data);
		});
	    });      
	    parser.parseString(xml);
	});    
    });  

    return self;
};

SpotifyClient.prototype.parseSearchResults = function(data){
    var self = this;
    var tracks = data.result.tracks;

    var numToReturn = 30;
    var results = new Object();
    var returnTracks = new Array();
  
    if(typeof(tracks) == 'undefined' || typeof(tracks[0].track) =='undefined' || typeof(tracks[0].track[0]) == 'undefined'){
	self.emit('searchResultsError', results);
	return self;
    }

    for(var i=0; i<numToReturn; i++){

	try{
	    var trackId = tracks[0].track[i].id[0];
	}
	catch(err){
	    self.emit('searchResultsError', results);
	    break;
	}

	self.getOembedResponseById('track', trackId).on('end'+trackId, function(trackData){
	    returnTracks.push({data: trackData});
	    if(returnTracks.length==numToReturn)
		self.emit('searchTracksReady', returnTracks);
	});        
    }

    self.on('searchTracksReady', function(data){
	results.tracks = data;
	self.emit('parseSearchResultsComplete', results);
    });

    return self;
};

module.exports = new SpotifyClient();    
