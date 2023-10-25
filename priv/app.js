const crossbarBaseURL = `https://${crossbarHost}:${crossbarPort}/v2`;
const accountId = localStorage.getItem('app-accountId')
const authToken = localStorage.getItem('app-authToken')
const ownerId = localStorage.getItem('app-ownerId')

const audioFail = new Audio('./fail.mp3')

const crossbar = {
    baseOptions: {
        headers: { 'Content-Type': 'application/json' },
    },
    request: async function (resource, options) {
        const response = await fetch(`${crossbarBaseURL}/${resource}`, {
            ...this.baseOptions,
            ...options,
        });
        const json = await response.json();

        if (response.ok) {
            return json;
        } else {
            throw new Error(`${json.message}: ${JSON.stringify(json)}`);
        }
    },
};

const errors = {
    el: document.getElementById('errors'),
    setMessage: function (message) {
        this.el.innerText = message;
    },
    clearMessage: function () {
        this.setMessage('');
    },
};
const loginForm = {
    el: document.getElementById('login-form'),
    getData: function () {
        return Object.fromEntries(new FormData(this.el));
    },
    hide: function () {
        this.setHidden(true);
    },
    show: function () {
        this.setHidden(false);
    },
    setHidden: function (hidden) {
        this.el.toggleAttribute('hidden', hidden);
    },
    onSubmit: function (cb) {
        this.el.addEventListener('submit', (event) => {
            event.preventDefault();
            cb(event);
        });
    },
};
const signInButton = {
    el: document.getElementById('sign-in-button'),
    enable: function () {
        this.setEnabled(true);
    },
    disable: function () {
        this.setEnabled(false);
    },
    setEnabled: function (enabled) {
        this.el.toggleAttribute('disabled', !enabled);
    },
};

loginForm.onSubmit(async (event) => {
    errors.clearMessage();
    signInButton.disable();

    const { username, password, account_name } = loginForm.getData();
    const reqData = {
        credentials: MD5(`${username}:${password}`),
        account_name,
    };

    try {
        const json = await crossbar.request('user_auth', {
            method: 'PUT',
            body: JSON.stringify({ data: reqData }),
        });

        loginForm.hide();
        whiteboard.show();
        whiteboard.enable(json.data.account_id, json.auth_token);

        localStorage.setItem('app-accountId', json.data.account_id);
        localStorage.setItem('app-authToken', json.auth_token);
        localStorage.setItem('app-ownerId', json.data.owner_id);
    } catch (e) {
        errors.setMessage(e.message);
    }

    signInButton.enable();
});

async function placeCall() {
  const response = await fetch(`${crossbarBaseURL}/accounts/${accountId}/users/${ownerId}/quickcall/1003`, {
    headers: {
      "X-Auth-Token": authToken
    }
  });
  const callInfo = await response.json();
  console.log('callInfo --', callInfo);
}

const whiteboard = {
    containerEl: document.getElementById('whiteboard-container'),
    canvasEl: document.getElementById('whiteboard-canvas'),
    context: {},
    webSocket: null,
    onWebSocketOpen: () => {},
    onWebSocketClose: () => {},
    onWebSocketData: () => {},
    onWebSocketError: () => {},
    enable: function (accountId, authToken) {
        this.context = { accountId, authToken };

        try {
            this.webSocket = new WebSocket(`wss://${blackholeHost}:${blackholePort}`);
            this.webSocket.onopen = () => { this.onWebSocketOpen(); };
            this.webSocket.onclose = ({ code, reason }) => {
                let message = `${code}`;

                if (reason) {
                    message += ` (${reason})`;
                }

                this.webSocket = null;
                this.onWebSocketClose(message);
            };
            this.webSocket.onmessage = ({ data }) => {
                this.onWebSocketData(data);
            };
            this.webSocket.onerror = (error) => {
                this.onWebSocketError(error);
            };
        } catch (e) {
            this.onWebSocketClose(e.message);
        }
    },
    disable: function () {
        if (this.webSocket) {
            this.webSocket.close();
        }
    },
    subscribe: function (binding) {
        this.sendCommand('subscribe', {
            auth_token: this.context.authToken,
            data: {
                account_id: this.context.accountId,
                binding,
            },
        });
    },
    sendCommand: function (action, data) {
        if (this.webSocket) {
            this.webSocket.send(JSON.stringify({
                action,
                ...data,
            }));
        }
    },
    draw: function (color, points, pointSize) {
        const ctx = this.canvasEl.getContext('2d');
        ctx.strokeStyle = color;
        ctx.lineWidth = pointSize;

        console.log('---------', color, points)

        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            let [x, y] = points[i];

            // Drawing centered on each point
            x = x - pointSize / 2;
            y = y - pointSize / 2;

            // y coords are inverted in Oculus app
            y = this.canvasEl.getAttribute('height') - y;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    },
    drawAgent: function(position) {
      const ctx = this.canvasEl.getContext('2d');
      ctx.strokeStyle = color;
      ctx.lineWidth = pointSize;

      const image = document.getElementById("agent1");

      image.addEventListener("load", (e) => {
        ctx.drawImage(image, 33, 71, 104, 124, 21, 20, 87, 104);
      });
    },
    clear: function () {
        const ctx = this.canvasEl.getContext('2d');
        ctx.reset();
    },
    hide: function () {
        this.setHidden(true);
    },
    show: function () {
        this.setHidden(false);
    },
    setHidden: function (hidden) {
      document.getElementById('app-container').toggleAttribute('hidden', hidden);
    },
};

whiteboard.onWebSocketOpen = () => {
    whiteboardStateMachine.handleConnected();
};

whiteboard.onWebSocketClose = (message) => {
    const e = new Error(`WebSocket closed: ${message}`);
    whiteboardStateMachine.handleError(e);
};

whiteboard.onWebSocketData = (data) => {
    try {
        const json = JSON.parse(data);

        if (json.status === 'error') {
            throw new Error(JSON.stringify(json.data));
        } else {
            whiteboardStateMachine.handleData(json.data);
        }
    } catch (e) {
        whiteboardStateMachine.handleError(e);
    }
};

const whiteboardStateMachine = {
    state: 'disconnected',
    reset: function () {
        this.state = 'disconnected';
        whiteboard.hide();
        whiteboard.disable();
        loginForm.show();
    },
    handleConnected: function () {
        this.state = 'connected';
        whiteboard.subscribe('collabazoo.event');
    },
    handleData: function (data) {
        if (this.state === 'connected') {
            const { event_category, event_name } = data;

            console.log('data ws -------------')

            if (event_category === 'collabazoo') {
                switch (event_name) {
                    case 'draw':
                        try {
                          const { rgb, points, point_size } = data;
                          const obstaclesMatch = points.reduce((accum, point) => accum || isInSquare(obstacleOnePink, point) || isInSquare(obstacleTwo, point), false);
                          const pointsMatch = pointsHitSquare(points, agentPositionBottomSquare) && pointsHitSquare(points, agentPositionTopSquare);
                          const isValid = pointsMatch && !obstaclesMatch;
                          const color = isValid ? 'green' : 'red';

                          whiteboard.draw(color, points, point_size);

                          if (!isValid) {
                            audioFail.play()
                          }

                          if (isValid) {
                            placeCall();
                          }
                        } catch (error) {
                          console.log('error ---', error)
                        }
                        break;

                    case 'clear':
                        whiteboard.clear();
                }
            }
        }
    },
    handleError: function (e) {
        this.reset();
        errors.setMessage(e.message);
    },
};

const clearButton = document.getElementById('clear-button');
clearButton.addEventListener('click', () => {
    whiteboard.sendCommand('collabazoo', {
        data: {
            account_id: whiteboard.context.accountId,
            command: 'clear',
        },
    });
});

if (!!accountId && !!authToken) {
  console.log('ids -----', accountId, authToken)
  whiteboard.enable(accountId, authToken)
  loginForm.hide();
  whiteboard.show();
}

var agentPositionTopSquare = [
  [
    1470,
    820
  ],
  [
    1470,
    720
  ],
  [
    1370,
    720
  ],
  [
    1370,
    820
  ],
  [
    1470,
    820
  ]
]

var agentPositionBottomSquare = [
  [
      150,
      60
  ],
  [
      150,
      160
  ],
  [
    250,
    160
  ],
  [
    250,
    60
  ],
  [
    150,
    60
  ]
]

const obstacleOnePink = [
  [660, 460],
  [660, 560],
  [760, 560],
  [760, 460],
  [660, 460]
];
const obstacleTwo = [
  [1210, 590],
  [1210, 690],
  [1310, 690],
  [1310, 590],
  [1210, 590]
];

whiteboard.draw('green', agentPositionBottomSquare, 4);

whiteboard.draw('green', agentPositionTopSquare, 4);

whiteboard.draw('pink', obstacleOnePink, 4)

whiteboard.draw('blue', obstacleTwo, 4)

const arrayMax = (array) => Math.max.apply(Math, array)
const arrayMin = (array) => Math.min.apply(Math, array)

function isInSquare(square, point) {
  var minX = arrayMin(square.map((point) => point[0]));
  var maxX = arrayMax(square.map((point) => point[0]));
  var minY = arrayMin(square.map((point) => point[1]));
  var maxY = arrayMax(square.map((point) => point[1]));

  console.log('coords', minX, maxX, minY, maxY, point)

  return point[0] >= minX && point[0] <= maxX && point[1] >= minY && point[1] <= maxY;
}

function pointsHitSquare(points, square) {
  return points.reduce((accum, point) => accum || isInSquare(square, point), false);
}

const data = [
  [
      170,
      91
  ],
  [
      165,
      130
  ],
  [
      141,
      94
  ],
  [
      167,
      84
  ],
  [
      182,
      129
  ],
  [
      146,
      128
  ],
  [
      145,
      85
  ],
  [
      178,
      105
  ],
  [
      161,
      131
  ],
  [
      140,
      91
  ],
  [
    1412,
    820
  ]
]

// console.log('is in square ----', data[0], isInSquare(agentPositionBottomSquare, data[0]), isInSquare(agentPositionTopSquare, data.reverse()[0]))


// whiteboard.drawAgent([])

/*
bottom point
[
    [
        171,
        91
    ],
    [
        165,
        130
    ],
    [
        141,
        94
    ],
    [
        167,
        84
    ],
    [
        182,
        129
    ],
    [
        146,
        128
    ],
    [
        145,
        85
    ],
    [
        178,
        105
    ],
    [
        161,
        131
    ],
    [
        140,
        91
    ]
]

[
    [
        158,
        78
    ],
    [
        166,
        111
    ],
    [
        138,
        97
    ]
]

[
    [
        166,
        82
    ],
    [
        168,
        110
    ],
    [
        134,
        108
    ]
]

[
    [
        166,
        84
    ],
    [
        172,
        119
    ],
    [
        140,
        97
    ]
]

top corner point
[
    [
        1471,
        827
    ],
    [
        1471,
        824
    ],
    [
        1470,
        823
    ],
    [
        1454,
        811
    ],
    [
        1468,
        780
    ],
    [
        1502,
        780
    ],
    [
        1499,
        833
    ],
    [
        1468,
        844
    ],
    [
        1486,
        791
    ],
    [
        1523,
        786
    ],
    [
        1506,
        832
    ],
    [
        1461,
        818
    ],
    [
        1493,
        786
    ],
    [
        1500,
        823
    ]
]
*/