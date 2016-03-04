/**
 * This is the main application module
 */
angular.module('App', ['Settings', 'Services', 'GameLogic', 'Drawing', 'ngMaterial'])

.controller('GameController', function($scope, $mdToast, $window, BlockFactory, Shapes, Colors, FIELD_UNIT_SIZE, FIELD_SIZE, DrawService, UtilService, PointsService) {
	var chatLog = document.getElementById("chatLog")
	
	var audioPath = "assets/";
    var manifest = [
        {id:"Drop", src:"drop.mp3"}
    ];
    createjs.Sound.registerManifest(manifest, audioPath);
	
	var KEY = {
        LEFT: 37,
        RIGHT: 39,
        UP: 38,
        DOWN: 40,
        SPACE: 32
    };
    var ACTION = KEY;
    ACTION.ROTATE = ACTION.UP;

    var stage;
    var fieldDimension = FIELD_SIZE;
    var fieldValues = [];

    var socket;
    $scope.statuses = { };
    $scope.chat = { };

    $scope.thumbnails = {};
    Object.keys(Shapes).forEach(function(value) {
        $scope.thumbnails[value] = UtilService.renderThumbnail(value);
    });

    $scope.isKeyDown = function(code) {
        if ($scope.keys["key" + code]) {
            return true;
        }
        return false;
    };

    // Clear KeyEvent
    function clearKeyEvent() {
        for (var code in $scope.keys) {
            if ($scope.keys.hasOwnProperty(code)) {
                $scope.keys[code] = false;
            }
        }
    }
	
	/**************************************************
	** GAME 
	**************************************************/
    var gameLoopStart = 0;
    // Game Loop
    function gameLoop(event) {
        var i, j;
        var x;
        var y;
        var r;
        var rowsToRemove = [];
        var currentRow;
        var hasFullRow;

        //No ActiveBlock -> New Block
        if (!$scope.activeBlock) {
            $scope.$apply(function() {
                $scope.activeBlock = $scope.nextBlock;
                $scope.nextBlock = BlockFactory.getRandomBlock();
                $scope.blocksCount[$scope.activeBlock.type].count++;
                $scope.totalBlockCount++;
            });
        }

        //Key Handlers
        if ($scope.isKeyDown(KEY.RIGHT)) {
            if (checkMove(ACTION.RIGHT)) {
                $scope.activeBlock.position.x++;
            }
        }
        else if ($scope.isKeyDown(KEY.LEFT)) {
            if (checkMove(ACTION.LEFT)) {
                $scope.activeBlock.position.x--;
            }
        }

        if ($scope.isKeyDown(KEY.UP)) {
            if (checkMove(ACTION.ROTATE)) {
                $scope.activeBlock.rotation = ($scope.activeBlock.rotation + 1) % 4;
            }
        }
        else if ($scope.isKeyDown(KEY.DOWN)) {
            if (checkMove(ACTION.DOWN)) {
                $scope.activeBlock.position.y++;
            }
        }

        if ($scope.isKeyDown(KEY.SPACE)) {
            for (var h = 0; h < fieldDimension[1]; h++) {
                if (checkMove(ACTION.DOWN)) {
                    $scope.activeBlock.position.y++;
                }
                else {
                    $scope.activeBlock.position.fixed = true;
                    updatePoints({
                        droppedLines: h
                    });
                    break;
                }
            }
            createjs.Sound.play("Drop");
        }

        clearKeyEvent();

        /* Start Game Loop */
        if (!gameLoopStart) {
            gameLoopStart = event.runTime;
        }
        var timeDiff = event.runTime - gameLoopStart;
        if (timeDiff > $scope.levelStepTime) {
            gameLoopStart = 0;

            if (checkMove(ACTION.DOWN)) {
                $scope.activeBlock.position.y++;
            }
            else {
                //Place Block and get new Block
                x = $scope.activeBlock.position.x;
                y = $scope.activeBlock.position.y;
                r = $scope.activeBlock.rotation;

                if (y < 0) {
                    $scope.$apply(function() {
                        $scope.gameStopped = true;
                        $scope.gameOver = true;
                        createjs.Ticker.removeEventListener("tick", gameLoop);
                    });
                    
					sendScores($scope.points, $scope.level, $scope.rowCount);
                }
                else {
                    for (i = 0; i < 4; i++) {
                        for (j = 0; j < 4; j++) {
                            if (Shapes[$scope.activeBlock.type][r][i][j]) {
                                fieldValues[y + i][x + j] = {
                                    color: $scope.activeBlock.color
                                };
                            }
                        }
                    }
                    $scope.activeBlock.position.fixed = true;
                }
            }

            if ($scope.activeBlock.position.fixed) {
                //Check for complete rows
                for (i = 0; i < fieldDimension[1]; i++) {
                    for (j = 0; j < fieldDimension[0]; j++) {
                        if (currentRow !== i) {
                            if (hasFullRow) {
                                rowsToRemove.push(currentRow);
                            }
                            currentRow = i;
                            hasFullRow = true;
                        }
                        if (!fieldValues[i][j]) {
                            hasFullRow = false;
                            break;
                        }
                    }
                }
                if (hasFullRow) {
                    rowsToRemove.push(currentRow);
                }
                removeRows(rowsToRemove);

                $scope.activeBlock = false;
            }

            sendStatus($scope.points, $scope.level, $scope.rowCount, stage.toDataURL());
        }

        if (!$scope.gameStopped) {
            drawAll();
        }
    }

    function removeRows(rowsArray) {
        if (rowsArray.length) {
            $scope.rowCount += rowsArray.length;

            rowsArray.forEach(function(row) {
                fieldValues.splice(row, 1);
                fieldValues.unshift(createEmptyRow());
            });

            updatePoints({
                clearedRows: rowsArray.length
            });
            updateLevel();
        }
    }

    function updatePoints(triggerObj) {
        var clearedRows = triggerObj.clearedRows || 0;
        var droppedLines = triggerObj.droppedLines || 0;
        var levelMultiplier = (1 + ($scope.level - 1) / 10);

        var points = PointsService.calculatePoints(clearedRows, droppedLines, levelMultiplier);

        $scope.points = $scope.points + points;
    }

    function updateLevel() {
        $scope.level = Math.floor($scope.rowCount / 10) + 1;
        $scope.levelStepTime = (-20) * ($scope.level + 1) + 500;
        if ($scope.levelStepTime < 0) {
            $scope.levelStepTime = 0;
        }
    }


    function checkMove(direction) {
        var i, j;
        var x = $scope.activeBlock.position.x;
        var y = $scope.activeBlock.position.y;
        var r = $scope.activeBlock.rotation;
        if ($scope.activeBlock.position.fixed) {
            return false;
        }

        switch (direction) {
        case ACTION.ROTATE:
            y = (y === -1) ? 0 : y;
            r = (r + 1) % 4;
            for (i = 0; i < 4; i++) {
                for (j = 0; j < 4; j++) {
                    if (Shapes[$scope.activeBlock.type][r][i][j]) {
                        if (x + j < 0 || x + j >= fieldDimension[0] || y + i >= fieldDimension[1] || fieldValues[y + i][x + j]) {
                            return false;
                        }
                    }
                }
            }
            break;
        case ACTION.DOWN:
            y = y + 1;
            y = (y === -1) ? 0 : y;
            for (i = 0; i < 4; i++) {
                for (j = 0; j < 4; j++) {
                    if (Shapes[$scope.activeBlock.type][r][i][j]) {
                        if (y + i >= fieldDimension[1] || fieldValues[y + i][x + j]) {
                            return false;
                        }
                    }
                }
            }
            break;
        case ACTION.LEFT:
            x = x - 1;
            y = (y === -1) ? 0 : y;
            for (i = 0; i < 4; i++) {
                for (j = 0; j < 4; j++) {
                    if (Shapes[$scope.activeBlock.type][r][i][j]) {
                        if (x + j < 0 || fieldValues[y + i][x + j]) {
                            return false;
                        }
                    }
                }
            }
            break;
        case ACTION.RIGHT:
            x = x + 1;
            y = (y === -1) ? 0 : y;
            for (i = 0; i < 4; i++) {
                for (j = 0; j < 4; j++) {
                    if (Shapes[$scope.activeBlock.type][r][i][j]) {
                        if (x + j >= fieldDimension[0] || fieldValues[y + i][x + j]) {
                            return false;
                        }
                    }
                }
            }
            break;
        }

        return true;
    }


    function drawField() {
        DrawService.drawField({
            fieldDimension: fieldDimension,
            fieldValues: fieldValues,
            stage: stage
        });
    }

    function drawActiveBlock() {
        DrawService.drawBlock({
            block: $scope.activeBlock,
            stage: stage
        });
    }

    function drawAll() {
        stage.removeAllChildren();
        drawField();
        if ($scope.activeBlock) {
            drawActiveBlock();
        }
        stage.update();
    }

    function createEmptyRow() {
        var emptyRow = [];
        for (var j = 0; j < fieldDimension[0]; j++) {
            emptyRow[j] = false;
        }
        return emptyRow;
    }

    function createBlockRow(freeBlock) {
        var row = [];

        for (var j = 0; j < fieldDimension[0]; j++) {
            row[j] = (j !== freeBlock) ? {
                color: '#666'
            } : false;
        }
        return row;
    }
	
	/**************************************************
	** GAME CONTROLS & INITIALIZATION 
	**************************************************/
    function initGame() {
        $scope.gameInitialized = true;
        $scope.gameOver = false;

        createjs.Ticker.timingMode = createjs.Ticker.RAF_SYNCHED;
        createjs.Ticker.setFPS(30);

        $scope.points = 0;
        $scope.level = 1;
        $scope.levelStepTime = (-20) * ($scope.level + 1) + 500;
        $scope.keys = {};
        $scope.blocksCount = {};
        $scope.totalBlockCount = 0;
        $scope.rowCount = 0;

        Object.keys(Shapes).forEach(function(value) {
            $scope.blocksCount[value] = {
                shape: Shapes[value],
                count: 0
            };
        });

        stage = new createjs.Stage("canvas");
        stage.enableMouseOver(0);
        stage.enableDOMEvents(false);

        for (var i = 0; i < fieldDimension[1]; i++) {
            fieldValues[i] = createEmptyRow();
        }

        $scope.nextBlock = BlockFactory.getRandomBlock();
        $scope.activeBlock = false;
        updateLevel();

        drawAll();
    }

    $scope.stopGame = function() {
        if ($scope.gameOver) {
            return;
        }
		window.onkeydown = function(e) {
            $scope.keys["key" + e.which] = false;
        };
        $scope.gameStopped = true;
        gameLoopStart = false;
        createjs.Ticker.removeEventListener("tick", gameLoop);
    };
    $scope.startGame = function() {
        if ($scope.gameOver) {
            return;
        }
		window.onkeydown = function(e) {
            $scope.keys["key" + e.which] = true;
            e.preventDefault();
        }
        $scope.gameStopped = false;
        createjs.Ticker.addEventListener("tick", gameLoop);
    };
    $scope.resetGame = function() {
        $scope.gameStopped = true;
        gameLoopStart = false;
        createjs.Ticker.removeEventListener("tick", gameLoop);
		window.onkeydown = function(e) {
            $scope.keys["key" + e.which] = false;
        };
        initGame();
    };

	/**************************************************
	** INITIALIZATION
	**************************************************/
	
    $scope.init = function() {
        if (!$scope.inputName) {
            return;
        }
        $scope.playerName = $scope.inputName;
		
		// Create WebSocket connection
		socket = new WebSocket("ws://broker.ngsmiths.com?key=demokey&id=" + $scope.playerName);
    
		// Register WebSocket events:
		socket.onopen = function(evt) { onOpen(evt) };
		socket.onclose = function(evt) { onClose(evt) };
		socket.onmessage = function(evt) { onMessage(evt) };
		socket.onerror = function(evt) { onError(evt) };
		
        initGame();
    };
	
	/**************************************************
	** CHAT
	**************************************************/
	$scope.sendChatMessage = function() {
		if (!$scope.chatMessage) {
            return;
        }
        sendMessage($scope.chatMessage)
		document.getElementById("chatText").value = "";
    };

	/**************************************************
	** WEBSOCKET FUNCTIONS
	**************************************************/
		
	function onOpen(evt)
	{
		console.log("Connected to socket server");
		// Join topic - we will be notified on all events...
		joinTopic();
		// Send first PING to the server:
		sendPing();
	};

	function onClose(evt)
	{
		console.log("Disconnected from socket server");
	};

	function onMessage(evt)
	{
		var message = JSON.parse(evt.data);
		
		if (message.type === "TOPIC-MEMBERS") {
			showSimpleToast("Welcome! You are currently player number " + message.data.members.length + " in this room.");
			$scope.playersCount = message.data.members.length;
		}
		else if (message.type === "MEMBER-JOINED") {
			showSimpleToast("New player has joined: " + message.data.member);
			$scope.playersCount++;
		}
		else if (message.type === "MEMBER-LEFT") {
			showSimpleToast("One player has left: " + message.data.member);
			$scope.$apply(function() {
				delete $scope.statuses[message.data.member];
			});
			$scope.playersCount--;
		}
		else if (message.type === "SCORES") {
			showSimpleToast(message.from + " has finished game with score: " + message.data.points)
		}
		else if (message.type === "STATUS") {
			$scope.$apply(function() {
				$scope.statuses[message.from] = message;
			});
		}
		else if (message.type === "MESSAGE") {
			$scope.$apply(function() {
				$scope.chat[timeNow()] = message;
			});
			chatLog.scrollTop = chatLog.scrollHeight;
		}
		else if (message.type === "PONG") {
			// Schedule new PING:
			executeAsync(function() {
				sendPing();
			});
		}
	};

	function onError(evt)
	{
		console.log("Disconnected from socket server due to error");
	};
	
	function joinTopic() {
		var message = { };
		message.type = "JOIN-TOPIC";
		message.to = "demo-tetris-topic";
		message.data = { };
		
		// Subscribe for presence:
		message.data.watch = true;
		
		// Send message:
		socket.send(JSON.stringify(message));
	};
	
	function sendStatus(points, level, rowCount, field) {
		var message = { };
		message.type = "STATUS";
		message.to = "tc://demo-tetris-topic"; // Send to the topic
		
		// Set data:
		message.data = { };
		message.data.points = points;
		message.data.level = level;
		message.data.rowCount = rowCount;
		message.data.field = field;
		
		// Send message:
		socket.send(JSON.stringify(message));
	};
	
	function sendScores(points, level, rowCount) {
		var message = { };
		message.type = "SCORES";
		message.to = "tc://demo-tetris-topic"; // Send to the topic
		
		// Set data:
		message.data = { };
		message.data.points = points;
		message.data.level = level;
		message.data.rowCount = rowCount;
		
		// Send message:
		socket.send(JSON.stringify(message));
	};
	
	function sendMessage(textMessage) {
		var message = { };
		message.type = "MESSAGE";
		message.data = { };
		message.data.message = textMessage;
		
		// Send message to the topic members:
		message.to = "tc://demo-tetris-topic";
		socket.send(JSON.stringify(message));
		// Now send one copy to myself:
		message.to = $scope.inputName;
		socket.send(JSON.stringify(message));
	};
	
	function sendPing() {
		var message = {};
		message.type = "PING";
		socket.send(JSON.stringify(message));
	}
	
	/**************************************************
	** OTHER STUFF:
	**************************************************/
	
	function timeNow(){
		var now= new Date(), 
		ampm= 'am', 
		h= now.getHours(), 
		m= now.getMinutes(), 
		s= now.getSeconds();
		if(h>= 12){
			if(h>12) h -= 12;
			ampm= 'pm';
		}

		if(m<10) m= '0'+m;
		if(s<10) s= '0'+s;
		return now.toLocaleDateString()+ ' ' + h + ':' + m + ':' + s + ' ' + ampm;
	};
	
	function showSimpleToast(message) {
		$mdToast.show(
			$mdToast.simple()
			.textContent(message)
			.hideDelay(5000)
			.position("bottom left right")
		);
	};
	
	function executeAsync(func) {
		setTimeout(func, 30000);
	};
});