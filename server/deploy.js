const WIDTH = 1920; 
const HEIGHT = 1080;

const rows = [2, 1, -1, -2];
const cols = [-1, 0, 1];

// Function to determine x and y values based on row and column
function getCoordinates(row, col) {
    let x, y;

    // Determine x based on column number
    x = (col + 1) * WIDTH;

    // Determine y based on row number
    if (row === 2) {
        y = 0;
    } else if (row === 1) {
        y = HEIGHT;
    } else if (row === -1) {
        y = 2 * HEIGHT;
    } else if (row === -2) {
        y = 3 * HEIGHT;
    }

    return { x, y };
}

// Function to create payload based on row, col, x, and y
function createPayload(row, col, x, y) {
    return {
        app: {
            states: {
                load: {
                    url: `http://[2a0c:5bc0:40:2e26:a057:9103:9bbd:da99]:3000/?row=${row}&col=${col}`
                }
            },
            url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
        },
        x: x,
        y: y,
        w: WIDTH,
        h: HEIGHT,
        space: "DOCluster"
    };
}


// Generate all payloads
const payloads = [
    // Line graph of tx fee
    {
        app: {
            states: {
                load: {
                    url: `http://[2a0c:5bc0:40:2e26:a057:9103:9bbd:da99]:3000/tx_fee`
                }
            },
            url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
        },
        x: 3 * WIDTH, 
        y: 0,
        w: WIDTH,       
        h: HEIGHT,  
        space: "DOCluster"  
    },
    // Line graph of tx rate
    {
        app: {
            states: {
                load: {
                    url: `http://[2a0c:5bc0:40:2e26:a057:9103:9bbd:da99]:3000/tx_rate`
                }
            },
            url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
        },
        x: 3 * WIDTH, 
        y: HEIGHT,
        w: WIDTH,       
        h: HEIGHT,  
        space: "DOCluster"  
    },
    // Histogram of tx value
    {
        app: {
            states: {
                load: {
                    url: `http://[2a0c:5bc0:40:2e26:a057:9103:9bbd:da99]:3000/tx_value`
                }
            },
            url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
        },
        x: 3 * WIDTH,  
        y: 2 * HEIGHT,
        w: WIDTH,       
        h: HEIGHT,  
        space: "DOCluster"  
    },
    // Histogram of tx size
    {
        app: {
            states: {
                load: {
                    url: `http://[2a0c:5bc0:40:2e26:a057:9103:9bbd:da99]:3000/tx_size`
                }
            },
            url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
        },
        x: 3 * WIDTH, 
        y: 3 * HEIGHT,
        w: WIDTH,       
        h: HEIGHT,  
        space: "DOCluster"  
    }
];

for (let row of rows) {
    for (let col of cols) {
        const { x, y } = getCoordinates(row, col);
        const payload = createPayload(row, col, x, y);
        payloads.push(payload);
        console.log(`Generated URL: ${payload.app.states.load.url}`);
    }
}


// Function to send API call
function sendApiCall(payload) {
    return fetch("http://gdo-apps.dsi.ic.ac.uk:9080/section", {
        method: "POST",
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Failed to load client on row ${payload.app.states.load.url.row} and col ${payload.app.states.load.url.col}`);
        }
        return response.json();
    })
    .then(data => {
        console.log('Client loaded:', data);
    })
    .catch(error => {
        console.error('Error:', error);
    });
}

// Send all API calls
Promise.all(payloads.map(payload => sendApiCall(payload)))
    .then(() => {
        console.log('All API calls completed.');
    })
    .catch(error => {
        console.error('Error in processing API calls:', error);
    });