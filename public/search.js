// Angular Code
var app = angular.module('Tau-Search', ['ngAnimate', 'ui.bootstrap']);

//TOM: init the scope
app.controller('searchFormController', function subtitleTableController($scope, $http, $location, $interval) {
	$scope.getQueryVariable = function (variable) {
		var query = window.location.search.substring(1);
		var vars = query.split('&');
		for (var i = 0; i < vars.length; i++) {
			var pair = vars[i].split('=');
			if (decodeURIComponent(pair[0]) == variable) {
				return decodeURIComponent(pair[1]);
			}
		}
	};

	$("#search-form").submit(function (e) {
		e.preventDefault();
	});

	$scope.searchResults = [];
	$scope.fileType = '';
	$scope.publicity = '';
	$scope.searchText = '';
	$scope.token = $scope.getQueryVariable('token');
	$http.defaults.headers.common['Authorization'] = 'Bearer ' + $scope.token;

	$scope.search = function () {
		if (!$scope.searchText) {
			$scope.addAlertMessage('Enter some text', 'warning');
		} else {
			$http.post('/api/search', {
				searchText: $scope.searchText,
				fileType: $scope.fileType,
				publicity: $scope.publicity
			}).then(function (result) {
				if (!result.data || result.data.length === 0) {
					$scope.addAlertMessage('No matching results', 'warning');
				} else {
					$scope.searchResults = result.data;
					$scope.addAlertMessage('Successfully fetched the search results', 'success');
				}

			}).catch(function (error) {
				$scope.addAlertMessage('Failed searching', 'warning');
			});
		}
	};

	$scope.ticksToTimeString = function (ticks, showMilliseconds) {
		if (showMilliseconds === undefined) {
			showMilliseconds = true;
		}

		if (ticks < 0) {
			return "--:--:--";
		}

		var milisecond = showMilliseconds ? parseInt((ticks * 1000) % 1000) : parseInt((ticks * 100) % 100);
		var sec = parseInt(ticks % 60);
		var min = parseInt(((ticks % 3600) / 60));
		var hour = parseInt((ticks / 3600));

		var secStr = "" + sec;
		var minStr = "" + min;
		var hourStr = "" + hour;
		var milisecondStr = "." + milisecond;

		if (sec < 10) {
			secStr = "0" + sec;
		}

		if (min < 10) {
			minStr = "0" + min;
		}

		if (hour < 10) {
			hourStr = "0" + hour;
		}

		return hourStr + ":" + minStr + ":" + secStr + milisecondStr;
	};

	$scope.alerts = [];

	// level:1 - success , 2- warning, 3 - alert
	$scope.addAlertMessage = function (text, level) {
		$scope.alerts.push({msg: text, type: level});
	}

	$scope.closeAlert = function (index) {
		$scope.alerts.splice(index, 1);
	};
});
