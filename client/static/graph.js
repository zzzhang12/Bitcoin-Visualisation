// Global variables
var paused = false;
var msgBuf = [];
const CLIENT_WIDTH = 1920;  
const CLIENT_HEIGHT = 1080;

// const CLIENT_WIDTH = 853;  
// const CLIENT_HEIGHT = 982; // For local testing

let socket, svg, g, link, node;
let offsetX, offsetY
let firstLoaded = false
let startTime
let isTopLeft
let originalGraphData = { nodes: [], edges: [] };
let hasDisplayedRange = false
let usdPrice
let orderedTxNodesByOutVals = [];
let orderedNodesByBalance = [];

window.addEventListener("load", init, false);


function init() {
    console.log("Initializing...");
    runWebSocket();
}


function runWebSocket() {
    // socket = io("http://[2a0c:5bc0:40:2e26:4961:8fe2:345d:7569]:3000/",{
    //     withCredentials: true,
    //     }
    // )
    socket = io(`http://${SOCKET_IP}:3000/`,{
        withCredentials: true,
        }
    )
    // socket = io("http://localhost:3000",{
    //     withCredentials: true,
    // }) // For local testing

    socket.on('connect', function() {
        console.log("Connected to server WebSocket");
    });

    socket.on('disconnect', function() {
        console.log('Disconnected from server');
    });

    socket.on('graph_data', function(msg) {
        console.log('Received graph data:', msg);
        if (!firstLoaded){
            console.log("First time loading graph")
            setTimer();
            firstLoaded = true
        }
        originalGraphData = JSON.parse(JSON.stringify(msg)); // Deep copy to preserve original data
        processMessage(msg);
    });

    socket.on('update_stats', function(stats) {
        if (isTopLeft){
            updateStats(stats);
        }

    });

    socket.on('connection_response', function(msg) {
        console.log('Server response:', msg);
    });
    
    socket.on('reload', function() {
        console.log("Reloading page because the server state has been reset");
        location.reload(); 
    });

    socket.on('usd_price', function(msg) {
        console.log("Received bitcoin price");
        usdPrice = msg;
    });

    socket.on('controller_command', function(msg) {
        console.log("Received controller command")
        if (msg.action === 'saveSnapshot') {
            saveGraphSnapshot();
        }
    });
};


function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
}


function setTimer(){
    startTime = Date.now();
    setInterval(updateObsTimer, 1000);
}


function updateObsTimer() {
    const elapsedTime = Date.now() - startTime;
    const seconds = Math.floor((elapsedTime / 1000) % 60);
    const minutes = Math.floor((elapsedTime / (1000 * 60)) % 60);
    const hours = Math.floor((elapsedTime / (1000 * 60 * 60)) % 24);

    document.getElementById('obsTimer').textContent = 
    `${hours}h ${minutes}m ${seconds}s`;
}


function updateStats(stats) {
    // console.log(stats)
    document.getElementById('statTxRate').innerHTML = stats.txRate ? stats.txRate.toLocaleString() : 'N/A';
    document.getElementById('txMaxVal').innerHTML = (stats.txMaxVal / 100000000).toLocaleString() + ' B /  ' + '<span class="usd-price">$'+ 
                                                    (usdPrice * stats.txMaxVal / 100000000).toFixed(2).toLocaleString() + '</span>';
    document.getElementById('txTotalVal').innerHTML = (stats.txTotalVal / 100000000).toLocaleString() + ' B /  ' + '<span class="usd-price">$'+ 
                                                    (usdPrice * stats.txTotalVal / 100000000).toFixed(2).toLocaleString() + '</span>';
    document.getElementById('txAvgVal').innerHTML = ((stats.txTotalVal / stats.numTx) * 1000 / 100000000).toLocaleString() + ' mB /  ' + '<span class="usd-price">$' +
                                                    ((usdPrice * stats.txTotalVal / stats.numTx) / 100000000).toFixed(2).toLocaleString() + '</span>';

    document.getElementById('txMaxFee').innerHTML = (stats.txMaxFee * 1000 / 100000000).toLocaleString() + ' mB /  ' + '<span class="usd-price">$'+
                                                    (usdPrice * stats.txMaxFee / 100000000).toFixed(2).toLocaleString()+ '</span>';
    document.getElementById('txTotalFee').innerHTML = (stats.txTotalFee / 100000000).toLocaleString() + ' B /  ' + '<span class="usd-price">$' +
                                                    (usdPrice * stats.txTotalFee / 100000000).toFixed(2).toLocaleString()+ '</span>';
    document.getElementById('txAvgFee').innerHTML = ((stats.txTotalFee / stats.numTx) * 1000 / 100000000).toLocaleString() + ' mB /  ' + '<span class="usd-price">$' + 
                                                    ((usdPrice * stats.txTotalFee / stats.numTx) / 100000000).toFixed(2).toLocaleString()+ '</span>';

    document.getElementById('txMaxSize').innerHTML = stats.txMaxSize.toLocaleString() + ' bytes'; 
    document.getElementById('txTotalSize').innerHTML = stats.txTotalSize.toLocaleString() + ' bytes';
    document.getElementById('txAvgSize').innerHTML = (stats.txTotalSize / stats.numTx).toLocaleString() + ' bytes';

    document.getElementById('txAvgFeeDens').innerHTML = (stats.txTotalFee / stats.txTotalSize).toLocaleString() + ' sat/byte / $' + 
                                                        (usdPrice * 1024 * stats.txTotalFee/(stats.txTotalSize*100000000)).toFixed(2).toLocaleString() + '/kB';;

    document.getElementById('statNumTx').innerHTML = stats.numTx.toLocaleString();
    document.getElementById('statNumIn').innerHTML = stats.numIn.toLocaleString();
    document.getElementById('statNumOut').innerHTML = stats.numOut.toLocaleString();
    document.getElementById('statNumNodes').innerHTML = stats.numNodes.toLocaleString();

    document.getElementById('balanceMax').innerHTML = stats.balanceMax ? 
                                                    (stats.balanceMax / 100000000).toLocaleString() + ' B /  ' + 
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceMax).toLocaleString()+ '</span>': 'N/A';
    document.getElementById('balanceMed').innerHTML =(stats.balanceMed !== null && stats.balanceMed !== undefined) ? 
                                                    (stats.balanceMed * 1000 / 100000000).toLocaleString() + ' mB /  ' + 
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceMed).toFixed(2).toLocaleString()+ '</span>': 'N/A';
    document.getElementById('balanceIQR').innerHTML = (stats.balanceIQR !== null && stats.balanceMed !== undefined)? 
                                                    (stats.balanceIQR * 1000 / 100000000).toLocaleString() + ' mB /  ' + 
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceIQR).toFixed(2).toLocaleString()+ '</span>': 'N/A';
}


function saveGraphSnapshot() {
    console.log("--------------SAVING GRAPH SNAPSHOT-------------")
    const graphData = {
        nodes: [],
        edges: [],
        stats: {}
    }
    if (isTopLeft){
        graphData.stats = {
            txRate: document.getElementById('statTxRate').textContent,
            txMaxVal: document.getElementById('txMaxVal').textContent,
            txTotalVal: document.getElementById('txTotalVal').textContent,
            txAvgVal: document.getElementById('txAvgVal').textContent,
            txMaxFee: document.getElementById('txMaxFee').textContent,
            txTotalFee: document.getElementById('txTotalFee').textContent,
            txAvgFee: document.getElementById('txAvgFee').textContent,
            txMaxSize: document.getElementById('txMaxSize').textContent,
            txTotalSize: document.getElementById('txTotalSize').textContent,
            txAvgSize: document.getElementById('txAvgSize').textContent,
            txAvgFeeDens: document.getElementById('txAvgFeeDens').textContent,
            numTx: document.getElementById('statNumTx').textContent,
            numIn: document.getElementById('statNumIn').textContent,
            numOut: document.getElementById('statNumOut').textContent,
            numNodes: document.getElementById('statNumNodes').textContent,
            balanceMax: document.getElementById('balanceMax').textContent,
            balanceMed: document.getElementById('balanceMed').textContent,
            balanceIQR: document.getElementById('balanceIQR').textContent,
        }
    }
    // Capture the current state of nodes
    originalGraphData.nodes.forEach(d => {
        let nodeRadius;
        if (d.type === 'tx') {
            nodeRadius = 4;
        } else if (d.type === 'input' || d.type === 'output') {
            nodeRadius = mapIqrScoreToRadius(d.iqr_score_balance); // Calculate the radius based on IQR score
        } else {
            nodeRadius = 1;
        }
        graphData.nodes.push({
            id: d.id,
            x: d.x,
            y: d.y,
            color: d.color,
            radius: nodeRadius,
            type: d.type,
            size: d.size,
            iqr_score_tx: d.iqr_score_tx,
            balance: d.balance,
            z_score_balance: d.z_score_balance,
            iqr_score_balance: d.iqr_score_balance
        });
    });

    // Capture the current state of edges
    originalGraphData.edges.forEach(d => {
        graphData.edges.push({
            source: d.source,
            target: d.target,
            color: d.color,
            type: d.type,
            size: d.size,
            iqr_score_tx: d.iqr_score_tx,
            strokeWidth: mapIqrScoreToThickness(d.iqr_score_tx)
        });
    });

    // Generate a timestamped filename
    const now = new Date();
    const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const filename = `graph_snapshot_${timestamp}.json`;

    // Send the graphData to the server
    fetch(`/save_snapshot?filename=${filename}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(graphData)
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === "success") {
            console.log("Graph snapshot saved successfully as ${filename}.");
        } else {
            console.error("Failed to save graph snapshot.");
        }
    })
    .catch(error => {
        console.error("Error saving graph snapshot:", error);
    });
}


function processMessage(msg){
    if (paused) {
        msgBuf.push(msg);
    }
    else {
        renderGraph(msg);
    }
}

// d3.json("static/test_data_4.json").then(function(graphData) {
//     renderGraph(graphData);
// }).catch(function(error) {
//     console.error("Error loading the graph data: ", error);
// });


function initializeGraph() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    console.log("width: ", width)
    console.log("height: ", height)


    svg = d3.select("svg")
        .call(d3.zoom().on("zoom", ({ transform }) => {
            g.attr("transform", transform);
        }))
        .append("g");

    g = svg.append("g");

    link = g.selectAll(".link");
    node = g.selectAll(".node");
}


function renderGraph(graphData) {
    console.log("Attempting to render graph");
    // console.log("Received graph data structure:", graphData);

    if (!Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
        console.error("Graph data is not correctly structured:", graphData);
        return;
    }

    const row = parseInt(getUrlParameter('row'), 10);
    const col = parseInt(getUrlParameter('col'), 10);

    // Determine if this is the top-left screen
    isTopLeft = (row === 2 && col === -1);
    const infoArea = document.getElementById('infoArea');
    if (isTopLeft) {
        infoArea.style.visibility = 'visible';
        infoArea.style.opacity = '1';
    }

     // Calculate offsets based on col and row
    //  offsetX = (col > 0 ? (col - 1) : (col + 1)) * CLIENT_WIDTH;  // for even numbers of cols
     offsetX = (col == 0 ? 0 : col * 0.5 * CLIENT_WIDTH);     
     offsetY = (row > 0 ? (row - 1) : (row + 1)) * CLIENT_HEIGHT;

    //  offsetX = 0 
    //  offsetY = 0  // uncomment when testing only 1 client

    // Scaling nodes
    const scaleFactorX = 1;
    const scaleFactorY = 1;

    graphData.nodes.forEach(node => {
        node.x = node.x * scaleFactorX;
        node.y = node.y * scaleFactorY;

        // Add node to global ordered lists
        if (node.type === 'tx') {
            // Update the ordered transaction list by outVals
            orderedTxNodesByOutVals.push(node);
        } else if (node.type === 'input' || node.type === 'output') {
            // Update the ordered nodes list by balance
            orderedNodesByBalance.push(node);
        }
    });
    
    // Sort the global lists (descending order by default)
    orderedTxNodesByOutVals.sort((a, b) => b.outVals - a.outVals);
    orderedNodesByBalance.sort((a, b) => b.balance - a.balance);
    
    // x and y value ranges based on client position
    let xMax, xMin, yMax, yMin
    if (col == 0){
        // const xInRange = node.x >= -0.5 * CLIENT_WIDTH && node.x <= 0.5 * CLIENT_WIDTH
        xMax = 0.5 * CLIENT_WIDTH
        xMin = -0.5 * CLIENT_WIDTH
    }
    else{
        xMax = col > 0 ? (offsetX + CLIENT_WIDTH) : offsetX
        xMin = col > 0 ? offsetX : (offsetX - CLIENT_WIDTH)
    }
    yMax = row > 0 ? (offsetY+ CLIENT_HEIGHT) : offsetY
    yMin = row > 0 ? offsetY : (offsetY - CLIENT_HEIGHT)

    // For local testing with 2 horizontally placed clients
    // xMax = col > 0 ? (offsetX + CLIENT_WIDTH) : offsetX
    // xMin = col > 0 ? offsetX : (offsetX - CLIENT_WIDTH)
    // yMax = row > 0 ? (offsetY+ CLIENT_HEIGHT) : offsetY
    // yMin = row > 0 ? offsetY : (offsetY - CLIENT_HEIGHT)

    // // For local testing with 1 client
    // xMax = 10000
    // xMin = -10000
    // yMax = 10000
    // yMin = -10000

    // Calculate the filtered nodes
    // let filteredNodes = graphData.nodes.filter(node => {

    //     const xInRange = node.x >= xMin && node.x <= xMax
    //     const yInRange = node.y >= yMin && node.y <= yMax
    //     // const xInRange = col > 0 ? (node.x >= offsetX && node.x <= (offsetX + CLIENT_WIDTH)) : (node.x < offsetX && node.x >= (offsetX - CLIENT_WIDTH));
    //     // const yInRange = row > 0 ? (node.y >= offsetY && node.y <= (offsetY + CLIENT_HEIGHT)) : (node.y < offsetY && node.y >= (offsetY - CLIENT_HEIGHT));
    //     // console.log(`Checking node ${node.id} at (${node.x}, ${node.y}): xInRange = ${xInRange}, yInRange = ${yInRange}`);
    //     return xInRange && yInRange;
    // });

    let filteredNodes = JSON.parse(JSON.stringify(graphData.nodes)).filter(node => {
        const xInRange = node.x >= xMin && node.x <= xMax;
        const yInRange = node.y >= yMin && node.y <= yMax;
        return xInRange && yInRange;
    });

    // console.log("Filtered nodes:", filteredNodes);

    // console.log(`Client offset (x, y): (${offsetX}, ${offsetY})`);
    if (!hasDisplayedRange){
        console.log(`Client x range: [${xMin}, ${xMax}]`);
        console.log(`Client y range: [${yMin}, ${yMax}]`);
        hasDisplayedRange = true;
    }

    // // Convert edges to reference the node objects
    // const nodeById = new Map(graphData.nodes.map(d => [d.id, d]));
    // graphData.edges.forEach(d => {
    //     d.source = nodeById.get(d.source);
    //     d.target = nodeById.get(d.target);
    // });

    filteredNodes.forEach(node => {
       if (row > 0){
            node.y = row * CLIENT_HEIGHT - node.y;
       }
       else if (row == -1){
            node.y = -1 * node.y;
       }
       else if (row == -2){
            node.y = Math.abs(node.y) - CLIENT_HEIGHT;
       }
       if (col == 0){
            node.x = node.x + 0.5 * CLIENT_WIDTH;
       }
       else if (col == 1){
            node.x = node.x - 0.5 * CLIENT_WIDTH;
       }
       else if (col == -1){
            node.x = node.x + 1.5 * CLIENT_WIDTH;
       }
    });

    // Filter edges based on the filtered nodes
    const filteredEdges = graphData.edges.filter(edge => {
        const sourceInFilteredNodes = filteredNodes.find(node => node.id === edge.source);
        const targetInFilteredNodes = filteredNodes.find(node => node.id === edge.target);

        // console.log(`Edge from ${edge.source} to ${edge.target} - source in: ${!!sourceInFilteredNodes}, target in: ${!!targetInFilteredNodes}`);

        return sourceInFilteredNodes && targetInFilteredNodes;
    });

    // console.log('Filtered edges:', filteredEdges);

    if (!svg) {
        initializeGraph();
    }

    // updateGraph(graphData);  // for testing with only client
    // updateGraph({nodes: filteredNodes, edges: filteredEdges}, count);
    updateGraph({nodes: filteredNodes, edges: filteredEdges});
}


function updateGraph(newGraphData) {
    console.log("Updating graph with new data:", newGraphData);

    if (!Array.isArray(newGraphData.nodes) || !Array.isArray(newGraphData.edges)) {
        console.error("New graph data is not correctly structured:", newGraphData);
        return;
    }

    // Capture the current positions of existing nodes
    const currentPositions = new Map();
    node.each(function(d) {
        const element = d3.select(this);
        currentPositions.set(d.id, {
            x: element.attr("cx"),
            y: element.attr("cy")
        });
        // console.log(`Captured position for node ID: ${d.id} - x: ${element.attr("cx")}, y: ${element.attr("cy")}`);
    });

    const existingNodes = new Set(node.data().map(d => d.id));
    const nodesToAdd = newGraphData.nodes.filter(node => !existingNodes.has(node.id));

    // console.log("number of nodesToAdd: ", nodesToAdd.length);

    // Update node data binding with new nodes
    node = node.data(newGraphData.nodes, d => d.id);

    // Remove exiting nodes
    node.exit().remove();

    // Transition existing nodes to new positions using attrTween
    node.transition()
        .duration(1500)
        .attrTween("cx", function(d) {
            const startPos = currentPositions.get(d.id) ? currentPositions.get(d.id).x : d.x;
            const endPos = d.x;
            return d3.interpolate(startPos, endPos);
        })
        .attrTween("cy", function(d) {
            const startPos = currentPositions.get(d.id) ? currentPositions.get(d.id).y : d.y;
            const endPos = d.y;
            return d3.interpolate(startPos, endPos);
        })
        .on("start", function(d) {
            const currentPos = currentPositions.get(d.id);
            // if (currentPos) {
            //     console.log(`Node transition start - ID: ${d.id}, x: ${currentPos.x}, y: ${currentPos.y}`);
            // } else {
            //     console.log(`Node transition start - ID: ${d.id}, no initial position`);
            // }
        })
        // .on("end", function(d) {
        //     console.log(`Node transition end - ID: ${d.id}, x: ${d.x - offsetX}, y: ${d.y - offsetY}`);
        // });

    // Add new nodes
    const nodeEnter = node.enter().append("circle")
        .attr("class", d => `node node-${d.id}`)
        // .attr("r", d => d.type === 'tx' ? 4 : 1)
        .attr("r", d => {
            if (d.type === 'tx'){
                return 4;
            }
            else if (d.type === 'input' || d.type === 'output'){
                return mapIqrScoreToRadius(d.iqr_score_balance);
            }
            else{
                return 1;
            }
        })
        // .attr("r", d => 5)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .style("fill", d => d.color)
        .on("click", function (event, d) {
            document.getElementById('infoBox').innerText = `Node ID: ${d.id}`;
        })
        .on("mouseover", function (event, d) {
            if (d.type !== 'tx' && d.balance !== null && d.balance !== undefined) {
                let value = (d.balance / 100000000).toPrecision(4);
                displayValue('balance', value, event.pageX, event.pageY, d.id);
            }
        });

    node = nodeEnter.merge(node);

    // Update link data binding
    const nodeById = new Map(newGraphData.nodes.map(d => [d.id, d]));
    newGraphData.edges.forEach(d => {
        d.source = nodeById.get(d.source) || d.source;
        d.target = nodeById.get(d.target) || d.target;
    });

    // Combine the existing links with the new links
    link = link.data(newGraphData.edges, d => `${d.source.id}-${d.target.id}`);
    // console.log("----link data----",link.data())

    // Remove exiting links
    link.exit().remove();

    // Transition existing links to new positions using attrTween
    link.transition()
        .duration(1500)
        .attrTween("x1", function(d) {
            const startPos = currentPositions.get(d.source.id) ? currentPositions.get(d.source.id).x : d.source.x;
            const endPos = d.source.x;
            return d3.interpolate(startPos, endPos);
        })
        .attrTween("y1", function(d) {
            const startPos = currentPositions.get(d.source.id) ? currentPositions.get(d.source.id).y : d.source.y;
            const endPos = d.source.y;
            return d3.interpolate(startPos, endPos);
        })
        .attrTween("x2", function(d) {
            const startPos = currentPositions.get(d.target.id) ? currentPositions.get(d.target.id).x : d.target.x;
            const endPos = d.target.x;
            return d3.interpolate(startPos, endPos);
        })
        .attrTween("y2", function(d) {
            const startPos = currentPositions.get(d.target.id) ? currentPositions.get(d.target.id).y : d.target.y;
            const endPos = d.target.y;
            return d3.interpolate(startPos, endPos);
        })
        .on("start", function(d) {
            const sourcePos = currentPositions.get(d.source.id);
            const targetPos = currentPositions.get(d.target.id);
            // if (sourcePos && targetPos) {
            //     console.log(`Link transition start - Source: ${d.source.id}, Target: ${d.target.id}, x1: ${sourcePos.x}, y1: ${sourcePos.y}, x2: ${targetPos.x}, y2: ${targetPos.y}`);
            // } else {
            //     console.log(`Link transition start - Source: ${d.source.id}, Target: ${d.target.id}, no initial position`);
            // }
        })
        // .on("end", function(d) {
        //     console.log(`Link transition end - Source: ${d.source.id}, Target: ${d.target.id}, x1: ${d.source.x - offsetX}, y1: ${d.source.y - offsetY}, x2: ${d.target.x - offsetX}, y2: ${d.target.y - offsetY}`);
        // });

    const linkEnter = link.enter().append("line")
        .attr("class", "link")
        .style("stroke", d => d.color)
        .style("stroke-width", d => {
            if (d.type === 'addr_link') {
                return 0.3;
            } else {
                const zScore = d.z_score_tx || 0.5;
                const iqr = d.iqr_score_tx || 0.5;
                // const strokeWidth = mapZScoreToThickness(zScore);
                const strokeWidth = mapIqrScoreToThickness(iqr);
                // console.log(zScore, strokeWidth)
                return strokeWidth;
            }
        })
        .on("mouseover", function (event, d) {
            let value;
            if (d.type != 'addr_link') {
                value = d.size;
                value = (value / 100000000).toPrecision(4);
                displayValue('transaction', value, event.pageX, event.pageY, `${d.source.id}-${d.target.id}`);
            }
        });

    link = linkEnter.merge(link);

    node.raise()

    ticked();
}


// function updateGraph(newGraphData, count) {
//     console.log("Updating graph with new data:", newGraphData);

//     if (!Array.isArray(newGraphData.nodes) || !Array.isArray(newGraphData.edges)) {
//         console.error("New graph data is not correctly structured:", newGraphData);
//         return;
//     }

//     // Capture the current positions of existing nodes
//     const currentPositions = new Map();
//     node.each(function(d) {
//         const element = d3.select(this);
//         currentPositions.set(d.id, {
//             x: element.attr("cx"),
//             y: element.attr("cy")
//         });
//         // console.log(`Captured position for node ID: ${d.id} - x: ${element.attr("cx")}, y: ${element.attr("cy")}`);
//     });

//     // const existingNodes = new Set(node.data().map(d => d.id));
//     // const existingEdges = new Set(link.data().map(d => `${d.source.id}-${d.target.id}`));
//     const newNodesSet = new Set(newGraphData.nodes.map(d => d.id));
//     const existingNodes = new Set(node.data().map(d => d.id).filter(id => newNodesSet.has(id)));

//     const newEdgesSet = new Set(newGraphData.edges.map(d => `${d.source}-${d.target}`));
//     const existingEdges = new Set(link.data().map(d => `${d.source.id}-${d.target.id}`).filter(id => newEdgesSet.has(id)));


//     const nodesToAdd = newGraphData.nodes.filter(node => !existingNodes.has(node.id));
//     const edgesToAdd = newGraphData.edges.filter(edge => !existingEdges.has(`${edge.source}-${edge.target}`));

//     // console.log("number of nodesToAdd: ", nodesToAdd.length);

//     // Update node data binding with new nodes
//     node = node.data(newGraphData.nodes, d => d.id);


//     // For testing only
//     let nodeTransitionStartCount = 0;
//     let nodeTransitionEndCount = 0;
//     let edgeTransitionStartCount = 0;
//     let edgeTransitionEndCount = 0;

//     const totalNodeTransitions = existingNodes.size;
//     const totalEdgeTransitions = existingEdges.size;

//     console.log("Num of nodes: ", totalNodeTransitions, "Num of edges: ", totalEdgeTransitions)

//     // Remove exiting nodes
//     node.exit().remove();

//     if (existingNodes.size > 0){
//         nodeTransition();

//         function nodeTransition(){
//             // Transition existing nodes to new positions using attrTween
//             node.transition()
//                 .duration(1000)
//                 .attrTween("cx", function(d) {
//                     const startPos = currentPositions.get(d.id) ? currentPositions.get(d.id).x : d.x - offsetX;
//                     const endPos = d.x - offsetX;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .attrTween("cy", function(d) {
//                     const startPos = currentPositions.get(d.id) ? currentPositions.get(d.id).y : d.y - offsetY;
//                     const endPos = d.y - offsetY;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .on("start", function(d) {
//                     nodeTransitionStartCount++;
//                     if (nodeTransitionStartCount === 1) {
//                         console.log("---All node transitions started---");
//                     }
//                     console.log(`Node transition started - ID: ${d.id}`);
//                 })
//                 .on("end", function(d) {
//                     nodeTransitionEndCount++;
//                     if (nodeTransitionEndCount >= totalNodeTransitions) {
//                         console.log("---All node transitions ended---");
//                     }
//                     console.log(`Node transition ended - ID: ${d.id}`);
//                     // addNewNodes()
//                 });
//         }
       

//             // Update link data binding
//             const nodeById = new Map(newGraphData.nodes.map(d => [d.id, d]));
//             newGraphData.edges.forEach(d => {
//                 d.source = nodeById.get(d.source) || d.source;
//                 d.target = nodeById.get(d.target) || d.target;
//             });

//             // Combine the existing links with the new links
//             link = link.data(newGraphData.edges, d => `${d.source.id}-${d.target.id}`);

//             // Remove exiting links
//             link.exit().remove();

//             edgeTransition();


//         function edgeTransition(){
//             // Transition existing links to new positions using attrTween
//             link.transition()
//                 .duration(1000)
//                 .attrTween("x1", function(d) {
//                     const startPos = currentPositions.get(d.source.id) ? currentPositions.get(d.source.id).x : d.source.x - offsetX;
//                     const endPos = d.source.x - offsetX;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .attrTween("y1", function(d) {
//                     const startPos = currentPositions.get(d.source.id) ? currentPositions.get(d.source.id).y : d.source.y - offsetY;
//                     const endPos = d.source.y - offsetY;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .attrTween("x2", function(d) {
//                     const startPos = currentPositions.get(d.target.id) ? currentPositions.get(d.target.id).x : d.target.x - offsetX;
//                     const endPos = d.target.x - offsetX;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .attrTween("y2", function(d) {
//                     const startPos = currentPositions.get(d.target.id) ? currentPositions.get(d.target.id).y : d.target.y - offsetY;
//                     const endPos = d.target.y - offsetY;
//                     return d3.interpolate(startPos, endPos);
//                 })
//                 .on("start", function(d) {
//                     edgeTransitionStartCount++;
//                     if (edgeTransitionStartCount === 1) {
//                         console.log("All edge transitions started");
//                     }
//                     console.log(`Edge transition started - Source: ${d.source.id}, Target: ${d.target.id}`);
//                 })
//                 .on("end", function(d) {
//                     edgeTransitionEndCount++;
//                     console.log(`Edge transition ended - Source: ${d.source.id}, Target: ${d.target.id}`);
//                     // if (edgeTransitionEndCount >= totalEdgeTransitions) {
//                     //     console.log("All edge transitions ended");
//                     //     addNewNodesAndEdges();
//                     // }
//                 });
//             }

//             Promise.all([nodeTransition, edgeTransition]).then(() => {
//                 console.log("All transitions completed, adding new nodes and edges.");
//                 addNewNodesAndEdges();
//             });
//     }
    

//     else{
//         addNewNodesAndEdges();
//     }

//     // Add new nodes
//     function addNewNodesAndEdges(){
//         console.log("--------------Adding new nodes------------")
//         const nodeEnter = node.enter().append("circle")
//         .attr("class", d => `node node-${d.id}`)
//         // .attr("r", d => d.type === 'tx' ? 4 : 1)
//         .attr("r", d => 5)
//         .attr("cx", d => d.x - offsetX)
//         .attr("cy", d => d.y - offsetY)
//         .style("fill", d => {
//             if (d.z_score_balance) {
//                 if (d.type === 'input') {
//                     d.color = mapZScoreToColor(d.z_score_balance, d.color);
//                 } else if (d.type === 'output') {
//                     d.color = mapZScoreToColor(d.z_score_balance, d.color);
//                 } 
//             }
//             return d.color;
//         })
//         .on("click", function (event, d) {
//             document.getElementById('infoBox').innerText = `Node ID: ${d.id}`;
//         })
//         .on("mouseover", function (event, d) {
//             if (d.type !== 'tx' && d.balance !== null && d.balance !== undefined) {
//                 displayValue('balance', d.balance, event.pageX, event.pageY, d.id);
//             }
//         })
//         .each(function(d) {
//             console.log(`New node added - ${d.id}}`);
//         });;

//         node = nodeEnter.merge(node);

//         // Update link data binding
//         const nodeById = new Map(newGraphData.nodes.map(d => [d.id, d]));
//         newGraphData.edges.forEach(d => {
//             d.source = nodeById.get(d.source) || d.source;
//             d.target = nodeById.get(d.target) || d.target;
//         });

//         // Combine the existing links with the new links
//         link = link.data(newGraphData.edges, d => `${d.source.id}-${d.target.id}`);
//         // console.log("----link data----",link.data())

//         // Remove exiting links
//         link.exit().remove();

//         console.log("--------------Adding new edges---------")
//         const linkEnter = link.enter().append("line")
//         .attr("class", "link")
//         .style("stroke", d => d.color)
//         .style("stroke", d => {
//             if (count !== 1) return '#008000'
//             else return d.color
//         })
//         .style("stroke-width", d => {
//             // if (d.type === 'addr_link') {
//             //     return 0.3;
//             // } else {
//             //     const zScore = d.z_score_tx || 0.5;
//             //     const strokeWidth = mapZScoreToThickness(zScore);
//             //     return strokeWidth;
//             // }
//             return 2
//         })
//         .on("mouseover", function (event, d) {
//             let value;
//             if (d.type != 'addr_link') {
//                 value = d.size;
//                 value = (value / 100000000).toPrecision(4);
//                 displayValue('transaction', value, event.pageX, event.pageY, `${d.source.id}-${d.target.id}`);
//             }
//         })
//         .each(function(d) {
//             console.log(`New edge added - Source: ${d.source.id}, Target: ${d.target.id}`);
//         });;

//         link = linkEnter.merge(link);
//         console.log("All new nodes and edges have been added.");
//     }

//     node.raise()
//     ticked();
// }

function mapIqrScoreToThickness(iqrScore) {
    const minThickness = 0.6;
    const medThickness = 2.0;
    const maxThickness = 6.0;

    let thickness;

    if (iqrScore <= 1) {
        const linearScale = d3.scaleLinear()
            .domain([-1, 0, 1])
            .range([minThickness, 1.0, medThickness])
            .clamp(true);
        
        thickness = linearScale(iqrScore);
    } else if (iqrScore > 1 && iqrScore <= 20){
        const largeValueScale = d3.scaleLinear()
            .domain([1, 50]) 
            .range([medThickness, 3.5])
            .clamp(true);
        
        thickness = largeValueScale(iqrScore);
    }
    else{
        const ExtremeValueScale = d3.scaleLinear()
            .domain([20, 300])  // For larger values of IQR score
            .range([3.5, maxThickness])
            .clamp(true);
        
        thickness = ExtremeValueScale(iqrScore);
    }
    console.log(`IQR Score: ${iqrScore}, Thickness: ${thickness}`);
    return thickness
}

function mapIqrScoreToRadius(iqrScore) {
    const minRadius = 0.9;
    const medRadius = 2.0;
    const maxRadius = 6.0;

    const linearScale = d3.scaleLinear()
        .domain([-1, 0, 1])  // Account for negative and positive IQR scores
        .range([minRadius, medRadius, maxRadius])  // Assign midpoints around typical values
        .clamp(true);

    // Map the IQR score to the radius based on sign
    const radius = linearScale(iqrScore);
    console.log(`IQR Score: ${iqrScore}, Radius: ${radius}`);
    return radius
}


// function ticked() {
//     // node.each(function(d) {
//     //     console.log(`Node ${d.id} position during tick: (${d.x}, ${d.y})`);
//     // });
//     link
//         .attr("x1", d => d.source.x - offsetX)
//         .attr("y1", d => d.source.y - offsetY)
//         .attr("x2", d => d.target.x - offsetX)
//         .attr("y2", d => d.target.y - offsetY);

//     node
//         .attr("cx", d => d.x - offsetX)
//         .attr("cy", d => d.y - offsetY);
// }


function ticked() {
    // // Debugging: Log nodes and links
    // console.log("Nodes during tick:", node.data());
    // console.log("Links during tick:", link.data());

    // node.each(function(d) {
    //     console.log(`Node ${d.id} position during tick: (${d.x}, ${d.y})`);
    // });

    node
    .attr("cx", d => {
        if (d.x === undefined) {
            console.error("Undefined x for node", d);
            return 0;
        }
        return d.x;
    })
    .attr("cy", d => {
        if (d.y === undefined) {
            console.error("Undefined y for node", d);
            return 0;
        }
        return d.y;
    });
    link
        .attr("x1", d => {
            if (!d.source || d.source.x === undefined) {
                console.error("Undefined source or source.x for link", d);
                return 0;
            }
            return d.source.x;
        })
        .attr("y1", d => {
            if (!d.source || d.source.y === undefined) {
                console.error("Undefined source or source.y for link", d);
                return 0;
            }
            return d.source.y;
        })
        .attr("x2", d => {
            if (!d.target || d.target.x === undefined) {
                console.error("Undefined target or target.x for link", d);
                return 0;
            }
            return d.target.x;
        })
        .attr("y2", d => {
            if (!d.target || d.target.y === undefined) {
                console.error("Undefined target or target.y for link", d);
                return 0;
            }
            return d.target.y;
        });
}


// Function to display transaction values for edges and address balance for nodes
function displayValue(type, value, x, y, id) {
    const displayText = type === 'balance' ? `balance: ${value} BTC` : `value: ${value} BTC`;
    const safeId = `tooltip-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    if (d3.select(`#${safeId}`).node()) {
        return; // Do not create another tooltip if one already exists
    }
    const tooltip = d3.select("body").append("div")
        .attr("id", safeId)
        .attr("class", "tooltip")
        .style("position", "absolute")
        .style("left", x + "px")
        .style("top", y + "px")
        .style("background", "rgba(0, 0, 0, 0.7)")
        .style("color", "white")
        .style("padding", "5px 10px")
        .style("border-radius", "5px")
        .style("pointer-events", "none")
        .style("opacity", 0)
        .text(displayText);

    tooltip.transition()
        .duration(100)
        .style("opacity", 1);

    setTimeout(() => {
        tooltip.transition()
            .duration(30)
            .style("opacity", 0)
            .remove();
    }, 1000);
}