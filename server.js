// set up ========================
var express = require('express');
var fs = require("fs")

var jwt = require('express-jwt');
var jwt_sign = require('jsonwebtoken');

var https = require('https');
var http = require('http');
// TODO: JORDAN -> Fix ../etc...
var privateKey = fs.readFileSync('./../../../etc/pki/tls/private/localhost.key', 'utf8');
var certificate = fs.readFileSync('./../../../etc/pki/tls/certs/localhost.crt', 'utf8');
var cauth = fs.readFileSync('./../../../etc/pki/tls/certs/ca-bundle.trust.crt', 'utf8');

var credentials = {ca: cauth, key: privateKey, cert: certificate};
var app = express();
var appHttp = express();

// httpsServer.listen(8443);

// var privateKey = fs.readFileSync('./../../../etc/pki/tls/private/localhost.key').toString();
// var certificate = fs.readFileSync('./../../../etc/pki/tls/certs/localhost.crt').toString();
// var certificateAuthority = fs.readFileSync('./../../../etc/pki/tls/certs/ca-bundle.trust.crt').toString();
// var app = express.createServer({key: privateKey, cert: certificate, ca: certificateAuthority});

var mongoose = require('mongoose');                     // mongoose for mongodb
var morgan = require('morgan');             // log requests to the console (express4)
var bodyParser = require('body-parser');    // pull information from HTML POST (express4)
var methodOverride = require('method-override'); // simulate DELETE and PUT (express4)
var randomstring = require("randomstring");
var fs = require('fs-extra');
var path = require('path');
var cmd = require('node-cmd');
var baseDir = "";
var fileSystemDir = "./public/SubtitlesRoot/";
var publicChaptersDir = "./public/main/FinalProject/public/Chapters/"
var latestHashFolder = fileSystemDir + "/hash/";
var assert = require('assert');

// Cross domain

app.all('/', function (req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "X-Requested-With");
	next();
});

appHttp.all('/', function (req, res, next) {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Headers", "X-Requested-With");
	next();
});

// Ignore self signed certificate
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// // Create LDAP client
var ldap = require('ldapjs');
var client = ldap.createClient({
	url: 'ldaps://ldap.tau.ac.il:636'
});

// // Bind LDAP server

client.bind("cn=videosubtitles,ou=appusers,o=tau", 'akdhgfhsiowh24jsg', function (err) {
	if (err != null) {
		console.log("Error while binding ldap:" + err);
	} else {
		console.log('Sucessfully bind ldap server.');
	}
});

// configuration =================

//mongoose.connect('mongodb://localhost/TauSubDb');

app.use(express.static(__dirname + '/public'));                 // set the static files location /public/img will be /img for users
app.use(morgan('dev'));                                         // log every request to the console
app.use(bodyParser.urlencoded({'extended': 'true', limit: '50mb'}));            // parse application/x-www-form-urlencoded
app.use(bodyParser.json({limit: '50mb'}));                                     // parse application/json
app.use(bodyParser.json({type: 'application/vnd.api+json', limit: '50mb'})); // parse application/vnd.api+json as json
app.use(methodOverride());

appHttp.use(express.static(__dirname + '/public'));
appHttp.use(morgan('dev'));                                         // log every request to the console
appHttp.use(bodyParser.urlencoded({'extended': 'true', limit: '50mb'}));            // parse application/x-www-form-urlencoded
appHttp.use(bodyParser.json({limit: '50mb'}));                                     // parse application/json
appHttp.use(bodyParser.json({type: 'application/vnd.api+json', limit: '50mb'})); // parse application/vnd.api+json as json
appHttp.use(methodOverride());

// define model =================
var Subtitles = mongoose.model('Subtitles', {
	text: String
});

// routes ======================================================================

// TODO: JORDAN - prod -> req.user.userId

//TOM: Handle user authentication
// // api ---------------------------------------------------------------------
app.post('/api/auth', function (req, res) {
	var userId = req.body.userId;
	var userPass = req.body.userPass;
	var sendResponse = true;

	var resp = {auth: false, mail: "", fullName: "", token: ""};

	if (!userId || !userPass) {

		if (sendResponse) {
			res.send(resp);
			sendResponse = false;
		}

		return;
	}

	var opts = {
		filter: '(&(objectclass=user)(uid=' + userId + '))',
		scope: 'sub',//default is sub tree
		attributes: ['dn', 'mail', 'fullName']
	};

	client.search('o=tau', opts, function (err, ldapRes) {
		console.log("Got response from ldap");

		ldapRes.on('searchEntry', function (entry) {
			console.log('entry: ' + JSON.stringify(entry.object));
			var userDn = entry.object.dn;
			if (userDn != null) {
				var usrClient = ldap.createClient({
					url: 'ldaps://ldap.tau.ac.il:636'
				});
				usrClient.bind(userDn, userPass, function (err) {
					console.log("ERROR:" + err)
					if (err != null) {
						console.error("Could not bind user to ldap server: " + err);
						if (sendResponse) {
							res.send(resp);
							sendResponse = false;
						}
					}
					console.log('Sucessfully bind user to ldap server!');
					resp.auth = true;
					resp.mail = entry.object.mail;
					resp.fullName = entry.object.fullName;
					resp.token = getUserSessionToken({mail: resp.mail, fullname: resp.fullName, userId: userId})
					console.log("response: " + JSON.stringify(resp));
					if (sendResponse) {
						res.send(resp);
						sendResponse = false;
					}
				});
			}

		});

		ldapRes.on('searchReference', function (referral) {
			console.log('referral: ' + referral.uris.join());
		});
		ldapRes.on('error', function (err) {
			console.error('error: ' + err.message);
		});
		ldapRes.on('end', function (result) {
			console.log('status: ' + result.status);
		});

	});

	setTimeout(function () {
		console.log("Return auth=false because of time out.");
		if (sendResponse) {
			res.send(resp);
			sendResponse = false;
		}
	}, 2000);
});

//TOM: Handle the saving of a subtitle file.

// TODO: JORDAN -> return the jwt secret!
appHttp.post('/api/saveSrtFileForUser', jwt({secret: getJWTSecret()}), function (req, res) {
//appHttp.post('/api/saveSrtFileForUser', function (req, res) {

	console.log(__dirname);
	console.log("userId: " + req.user.userId);
	var userId = req.user.userId;

	// JORDAN - some new flags of private and file type (and saving them accordingly
	var isPrivate = req.body.private;
	var fileType = req.body.fileType;
	var privateDirectory = isPrivate ? userId : '';

	fileType = fileType === 'remarks' ? fileType : '';

	var fileExtension = fileType ? '-' + fileType : '';

	var videoId = req.body.videoId;

	var dir = fileSystemDir + getOutputFilePath(userId, videoId);
	var gitVideoDir = fileSystemDir + getOutputVideoFolder(videoId);
	var jsonFilePath = path.join(dir, privateDirectory, userId + fileExtension + ".json");
	var latestJsonFilePath = path.join(gitVideoDir, privateDirectory, videoId + fileExtension + "_latest.json");
	var creditsFilePath = path.join(gitVideoDir, privateDirectory, videoId + fileExtension + "_credits.json");
	var randString = randomstring.generate(25);
	var srtFilePath = path.join(latestHashFolder, videoId, randString + fileExtension + ".srt");
	var latestSrtFilePath = path.join(latestHashFolder, videoId, privateDirectory, 'latest' + fileExtension + ".srt");
	var txtFilePath = path.join(latestHashFolder, videoId, randString + "_plain" + fileExtension + ".txt");
	var chapterFilePath = path.join(publicChaptersDir + videoId, privateDirectory, "latestChapter" + fileExtension + ".srt");

	var subObj = mergeSubsToObject(req, latestJsonFilePath);

	fs.createFile(jsonFilePath, function (err) {
		if (err) {
			return console.log(err);
		}

		//file has now been created, including the directory it is to be placed in
		fs.writeFile(jsonFilePath, JSON.stringify(subObj), function (err) {
			if (err) {
				return console.log(err);
			}

			console.log("Json file was saved to " + jsonFilePath + " !");

			console.log("json saved: " + JSON.stringify(subObj));
			// console.log("json saved2: " + subString);
			subObjWithCredits = addCredits(creditsFilePath, userId, subObj);

			fs.createFile(srtFilePath, function (err) {
				fs.writeFile(srtFilePath, generateSrtFile(subObjWithCredits, false), function (err) {
					if (err) {
						return console.log(err);
					}

					console.log("Srt file was saved!");
					console.log("Commiting with git");
					cmd.get(
						'cd ' + gitVideoDir + '&& git add . && git commit -am "commiting in the name of:' + userId + '"',
						function (data) {
							console.log('git cmd finished : ', data);

							fs.writeFile(latestJsonFilePath, JSON.stringify(subObj), function (err) {
								if (err) {
									return console.log(err);
								}

								console.log("Latest Json file was saved!");

								res.send(randString);
							});
						}
					);
				});
			});

			// JORDAN - added latest srt file and not just chapters like there was before.
			fs.createFile(latestSrtFilePath, function (err) {
				fs.writeFile(latestSrtFilePath, generateSrtFile(subObjWithCredits, false), function (err) {
					if (err) {
						return console.log(err);
					}

					console.log("Latest SRT file was saved");
				});
			});

			fs.createFile(txtFilePath, function (err) {
				fs.writeFile(txtFilePath, generateTextFile(subObj), function (err) {
					if (err) {
						return console.log(err);
					}

					console.log("text file was saved!");

				});
			});

			fs.createFile(chapterFilePath, function (err) {
				fs.writeFile(chapterFilePath, generateSrtFile(subObj, true), function (err) {
					if (err) {
						return console.log(err);
					}

					console.log("Chapter file was saved!");
				});
			});

		});
	});

});

//TOM: user download subtitle file

appHttp.get('/api/getLatestSubtitles/:videoId/:hashCode/:isRemark', function (req, res) {
	var videoId = req.params.videoId;
	var hashCode = req.params.hashCode;
	var isRemark = req.params.isRemark === true || req.params.isRemark === 'true';

	var extension = isRemark ? '-remarks' : '';

	var fileName;
	var downloadFileName;

	if (hashCode.endsWith("_plain")) {
		fileName = hashCode + extension + ".txt";
		downloadFileName = videoId + '_plain' + (extension ? extension : '-subtitles') + '.txt';
	}
	else {
		fileName = hashCode + extension + ".srt";
		downloadFileName = videoId + (extension ? extension : '-subtitles') + '.srt';
	}

	console.log("Got a download request to retreive srt\\text for hashCode: " + hashCode);

	var filePath = latestHashFolder + videoId + '/' + fileName;

	if (!fileExists(filePath)) {
		console.log('file does not exist');
		res.send('fileNotExist');
		return;
	}

	// if(fileExists)
	// data = fs.readFileSync(latestJsonFilePath);
	// Subtitles = JSON.parse(data);

	res.setHeader('Content-disposition', 'attachment; filename=' + downloadFileName);
	res.setHeader('Content-type', 'text/srt');

	var filestream = fs.createReadStream(filePath);
	filestream.pipe(res);

	console.log('starting download');
});

//TOM: get the video stream - should change here to make many optional comment files per one video.
appHttp.get('/api/getLatestJsonSub/:videoId', function (req, res) {
	var videoId = req.params.videoId;
	var gitVideoDir = fileSystemDir + getOutputVideoFolder(videoId);
	var latestJsonFilePath = path.join(gitVideoDir, videoId + "_latest.json");

	if (!fileExists(latestJsonFilePath)) {
		console.log('video latest file does not exist');
		var subtitle = [{
			id: guid(),
			startTime: 0,
			endTime: -1,
			txt: ""
		}];
		// console.log("sent subtitle id: " + subtitle[0].id);
		res.send(JSON.stringify(subtitle));

		return;
	}

	fs.readJson(latestJsonFilePath, function (err, jsonObj) {
		res.send(jsonObj);
	});
});

appHttp.get('/api/test_subtitles', function (req, res) {
	var latestJsonFilePath = __dirname + 'public/Videos/Martin.vtt';
	console.log(process.cwd());

	if (!fileExists(latestJsonFilePath)) {
		console.log('video latest file does not exist');
		var subtitle = [{
			id: guid(),
			startTime: 0,
			endTime: -1,
			txt: ""
		}];
		// console.log("sent subtitle id: " + subtitle[0].id);
		res.send(JSON.stringify(subtitle));

		return;
	}

	fs.readJson(latestJsonFilePath, function (err, jsonObj) {
		res.send(jsonObj);
	});
});

appHttp.get('/api/test_video/user', jwt({secret: getJWTSecret()}), function (req, res) {
// appHttp.get('/api/test_video/user', function (req, res) {
	res.send({userId: req.user.userId});
});

// JORDAN - new API call - returns the metadata from the DB (you can see the data on Videos.json
appHttp.get('/api/test_video/metadata/:videoId', jwt({secret: getJWTSecret()}), function (req, res) {
// appHttp.get('/api/test_video/metadata/:videoId', function (req, res) {
	var videosJsonPath = __dirname + '/DB/Videos.json';

	fs.readJson(videosJsonPath, function (err, jsonObj) {
		res.json({
			videoMetadata: jsonObj.find(function (videoMetadata) {
				return videoMetadata.videoId === req.params.videoId;
			}),
			userId: req.user.userId
		});
	});
});

// JORDAN - new API call - setting new metadata on save. Saved by a few flags - private and fileType.
appHttp.post('/api/test_video/metadata/:videoId', jwt({secret: getJWTSecret()}), function (req, res) {
// appHttp.post('/api/test_video/metadata/:videoId', function (req, res) {
	var keyToUpdate = req.body.key;
	var value = req.body.value;
	var isPrivate = req.body.private;

	var userId = req.user.userId;

	var videosJsonPath = __dirname + '/DB/Videos.json';

	fs.readJson(videosJsonPath, function (err, jsonObj) {
		var foundIndex = undefined;

		jsonObj.find(function (videoMetadata, index) {
			if (videoMetadata.videoId === req.params.videoId) {
				foundIndex = index;
				return true;
			}
		});

		if (foundIndex === undefined) {
			foundIndex = jsonObj.length;
			jsonObj.push({videoId: req.params.videoId});
		}

		if (isPrivate) {
			jsonObj[foundIndex][userId] = jsonObj[foundIndex][userId] ? jsonObj[foundIndex][userId] : {};
			jsonObj[foundIndex][userId][keyToUpdate] = value;
		}
		else {
			jsonObj[foundIndex][keyToUpdate] = value;
		}

		fs.writeJson(videosJsonPath, jsonObj, function (err) {
			if (err) {
				res.status(500).send('Failed updating video metadata');
			} else {
				res.status(200).send('Updated video metadata');
			}
		});
	});
});

// JORDAN - search api - getting all search results, by flags, etc...
appHttp.post('/api/search', jwt({secret: getJWTSecret()}), function (req, res) {
// appHttp.post('/api/search', function (req, res) {
	var searchText = req.body.searchText;
	var fileType = req.body.fileType;
	var publicity = req.body.publicity ? req.body.publicity : 'any';

	if (!searchText) {
		res.status(400).send('You should pass search text');
	}
	else if (!(!fileType || fileType === 'subtitles' || fileType === 'remarks')) {
		res.status(400).send('File type should be sent as \'subtitles\' or \'remarks\' or not sent at all');
	} else {

		var userId = req.user.userId;

		var videosJsonPath = __dirname + '/DB/Videos.json';

		function mapData(relevantData, videoId, fileType, publicity) {
			return relevantData.map(function (data) {
				return {
					txt: data.txt,
					videoId: videoId,
					startTime: data.startTime,
					endTime: data.endTime,
					totalVotes: data.totalVotes,
					type: fileType,
					publicity: publicity
				};
			})
		}

		fs.readJson(videosJsonPath, function (err, allVideosData) {
			if (err) {
				res.status(500).send('There was an error accessing the DB');
			}
			else {
				var searchResults = [];

				allVideosData.forEach(function (videoMetadata) {
					var relevantSubtitles = [];
					var relevantRemarks = [];
					var privateRelevantSubtitles = [];
					var privateRelevantRemarks = [];

					if (!fileType) {
						if (publicity === 'any') {
							relevantSubtitles = getData(videoMetadata, 'subtitles');
							relevantRemarks = getData(videoMetadata, 'remarks');
							privateRelevantSubtitles = getPrivateData(videoMetadata, userId, 'subtitles');
							privateRelevantRemarks = getPrivateData(videoMetadata, userId, 'remarks');
						}
						else {
							if (publicity === 'private') {
								privateRelevantSubtitles = getPrivateData(videoMetadata, userId, 'subtitles');
								privateRelevantRemarks = getPrivateData(videoMetadata, userId, 'remarks');
							} else {
								relevantSubtitles = getData(videoMetadata, 'subtitles');
								relevantRemarks = getData(videoMetadata, 'remarks');
							}
						}
					} else {
						if (publicity === 'any') {
							if (fileType === 'subtitles') {
								relevantSubtitles = getData(videoMetadata, fileType);
								privateRelevantSubtitles = getPrivateData(videoMetadata, userId, fileType);
							} else {
								relevantRemarks = getData(videoMetadata, fileType);
								privateRelevantRemarks = getPrivateData(videoMetadata, userId, fileType);
							}
						}
						else {
							if (publicity === 'private') {
								if (fileType === 'subtitles') {
									privateRelevantSubtitles = getPrivateData(videoMetadata, userId, fileType);
								} else {
									privateRelevantRemarks = getPrivateData(videoMetadata, userId, 'remarks');
								}
							}
							else {
								if (fileType === 'subtitles') {
									relevantSubtitles = getData(videoMetadata, fileType);

								} else {
									relevantRemarks = getData(videoMetadata, fileType);
								}
							}
						}
					}

					relevantSubtitles = relevantSubtitles ? mapData(relevantSubtitles, videoMetadata.videoId, 'public', 'subtitles') : [];
					relevantRemarks = relevantRemarks ? mapData(relevantRemarks, videoMetadata.videoId, 'public', 'remarks') : [];
					privateRelevantSubtitles = privateRelevantSubtitles ? mapData(privateRelevantSubtitles, videoMetadata.videoId, 'private', 'subtitles') : [];
					privateRelevantRemarks = privateRelevantRemarks ? mapData(privateRelevantRemarks, videoMetadata.videoId, 'private', 'remarks') : [];

					searchResults = searchResults.concat(relevantSubtitles, relevantRemarks, privateRelevantSubtitles, privateRelevantRemarks);
				});

				res.status(200).send(searchResults);
			}
		});
	}

	function getData(videoMetadata, dataType) {
		if (videoMetadata[dataType]) {
			return videoMetadata[dataType].filter(function (data) {
				return data.txt.indexOf(searchText) >= 0;
			});
		}

		return [];
	}

	function getPrivateData(videoMetadata, userId, dataType) {
		if (videoMetadata[userId]) {
			return getData(videoMetadata[userId], dataType);
		}
	}
});

// listen (start app with node server.js) ======================================
portHttps = 9443;
portHttp = 9080;

https.createServer(credentials, app).listen(portHttps);
console.log("HTTPS App listening on port " + portHttps);

http.createServer(appHttp).listen(portHttp);
console.log("HTTP App listening on port " + portHttp);

// set up a route to redirect http to https
// appHttp.get('*',function(req,res) {
//     res.redirect('https://lool.tau.ac.il'+req.url)
// })

cmd.get(
	'chdir', // Change to 'pwd' in linux
	function (data) {
		console.log('the current working dir is : ', data)
		baseDir = data;
	});

cmd.get(
	'mkdir ' + __dirname + fileSystemDir + ' && cd ' + __dirname + fileSystemDir + ' && git init', // Change to 'pwd' in linux
	function (data) {
		console.log('created git repository : ', data)
		baseDir = data;
	});

process.on('uncaughtException', function (err) {
	console.log(err);
	console.log(__dirname);
});

// Private functions

function getOutputFilePath(userId, videoId) {
	return getOutputVideoFolder(videoId) + "/" + userId + "_Subs";
}

function getOutputVideoFolder(videoId) {
	return "/Subtitles/" + "/" + videoId;
}

function guid() {
	function s4() {
		return Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
	}

	return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

function generateSrtFile(subObj, chapters) {
	var srtFile = "";
	var i = 1;

	subObj.forEach(function (line) {
		srtFile += i + "\r\n";
		srtFile += ticksToTimeString(line.startTime) + " --> " + ticksToTimeString(line.endTime) + "\r\n";

		if (chapters) {
			srtFile += "#" + i + "\r\n";
		}
		else {
			var txt = line.txt;
			if (txt.length < 40) {
				srtFile += txt + "\r\n";
			}
			else {
				var spaceLocation = txt.indexOf(' ', txt.length / 2 - 5);

				if (spaceLocation == -1) {
					srtFile += txt + "\r\n";
				}
				else {
					srtFile += txt.substring(0, spaceLocation) + "\r\n";
					srtFile += txt.substring(spaceLocation + 1) + "\r\n";
				}
			}
		}

		srtFile += "\r\n";

		i++;
	});

	return srtFile;
}

function generateTextFile(subObj) {
	var srtFile = "";
	var i = 0;

	subObj.forEach(function (line) {
		srtFile += line.txt + '/';
		i++;
		if (i % 3 == 0) {
			srtFile += "\r\n";
		}
	});

	return srtFile;
}

function ticksToTimeString(ticks) {
	if (ticks < 0) {
		return "--:--:--";
	}
	;

	var milisecond = parseInt((ticks * 1000) % 1000);
	var sec = parseInt(ticks % 60);
	var min = parseInt(((ticks % 3600) / 60));
	var hour = parseInt((ticks / 3600));

	var secStr = "" + sec;
	var minStr = "" + min;
	var hourStr = "" + hour;
	var milisecondStr = "," + milisecond;

	if (sec < 10) {
		secStr = "0" + sec;
	}
	;

	if (min < 10) {
		minStr = "0" + min;
	}
	;

	if (hour < 10) {
		hourStr = "0" + hour;
	}
	;

	return hourStr + ":" + minStr + ":" + secStr + milisecondStr;
};

//TOM: adds the new subtitles to the latest version on the server
function mergeSubsToObject(req, latestJsonFilePath) {

	newSubtitles = JSON.parse(req.body.txt);

	if (!fileExists(latestJsonFilePath)) {
		return newSubtitles;
	}

	var joinedSubs = [];

	data = fs.readFileSync(latestJsonFilePath);

	oldSubtitles = JSON.parse(data);
	console.log('oldSubtitles : ', oldSubtitles);
	console.log('oldSubtitles[0] : ', oldSubtitles[0]);

	// console.log('added : ', req.body.added);
	// console.log('deleted : ', req.body.deleted);
	// console.log('edited : ', req.body.edited);
	added = JSON.parse(req.body.added);
	deleted = JSON.parse(req.body.deleted);
	edited = JSON.parse(req.body.edited);

	// remove old subtitles that were deleted or edited
	for (var i = oldSubtitles.length - 1; i >= 0; i--) {
		if (deleted[oldSubtitles[i].id] || edited[oldSubtitles[i].id]) {
			// console.log('deleting from old deleted|edited : <id: ' + oldSubtitles[i].id + '> ');
			oldSubtitles.splice(i, 1);
		}
		else {
			for (var j = newSubtitles.length - 1; j >= 0; j--) {
				if (oldSubtitles[i].id == newSubtitles[j].id) {
					// console.log('deleting from old same as new: <id: ' + oldSubtitles[i].id + '> ');
					oldSubtitles.splice(i, 1);
					break;
				}
			}
		}
	}

	var iNew = 0;
	var iOld = 0;

	while (iNew < newSubtitles.length && iOld < oldSubtitles.length) {
		// Untouched subtitles
		if (newSubtitles[iNew].id == oldSubtitles[iOld].id) {
			// console.log('adding joined : <id: ' + newSubtitles[iNew].id + '>');
			joinedSubs.push(newSubtitles[iNew]);
			iNew++;
			iOld++;
		}

		// No overlap - new is before
		else if (isBeforeNoOverlap(newSubtitles[iNew], oldSubtitles[iOld])) {
			// console.log('adding new : <id: ' + newSubtitles[iNew].id + '>');
			joinedSubs.push(newSubtitles[iNew]);
			iNew++;
		}

		// No overlap - old is before
		else if (isBeforeNoOverlap(oldSubtitles[iOld], newSubtitles[iNew])) {
			// console.log('adding old : <id: ' + oldSubtitles[iOld].id + '>');
			joinedSubs.push(oldSubtitles[iOld]);
			iOld++;
		}

		// Overlapping subtitles - we'll take the new one
		else {
			// console.log('overlap: adding new : <id: ' + newSubtitles[iNew].id + '>');
			joinedSubs.push(newSubtitles[iNew]);
			iNew++;
			iOld++;
		}
	}

	// insert remaining subs
	for (; iNew < newSubtitles.length; iNew++) {
		// console.log('remaining: adding new : <id: ' + newSubtitles[iNew].id + '>');
		joinedSubs.push(newSubtitles[iNew]);
	}
	for (; iOld < oldSubtitles.length; iOld++) {
		// console.log('remaining: adding old : <id: ' + oldSubtitles[iOld].id + '>');
		joinedSubs.push(oldSubtitles[iOld]);
	}

	return joinedSubs;
}

function addCredits(creditsFilePath, userId, subObj) {
	credits = {};

	if (fileExists(creditsFilePath)) {
		data = fs.readFileSync(creditsFilePath);
		credits = JSON.parse(data);
	}

	credits[userId] = true;

	fs.createFile(creditsFilePath, function (err) {
		if (err) {
			return console.log(err);
		}
		fs.writeFile(creditsFilePath, JSON.stringify(credits), function (err) {
			if (err) {
				return console.log(err);
			}
			console.log("Credits were saved");
		});
	});

	var creditLine = "Credits: ";
	users = Object.keys(credits);
	for (var i = users.length - 1; i >= 0; i--) {
		creditLine += users[i];
		if (i != 0) {
			creditLine += ", ";
		}
	}

	var creditSub = {
		id: "credit",
		startTime: 0,
		endTime: 5,
		txt: creditLine
	}

	var subObjWithCredits = [creditSub];
	for (var i = 0; i < subObj.length; i++) {
		if (isBeforeNoOverlap(creditSub, subObj[i])) {
			subObjWithCredits.push(subObj[i]);
		}
	}

	return subObjWithCredits;
}

//TOM: check if times are overlaping
function isBeforeNoOverlap(firstSub, secondSub) {
	return (firstSub.endTime < secondSub.startTime)
}

function fileExists(filePath) {
	try {
		return fs.statSync(filePath).isFile();
	}
	catch (err) {
		return false;
	}
}

function getUserSessionToken(usr) {
	var cert = getJWTSecret();

	var currUsr = usr == null ? {} : usr;
	return jwt_sign.sign(currUsr, cert, {expiresIn: 60 * 60 * 24});
}

function getJWTSecret() {
	return "mySecret";
}
    