/**
 * Created by zz3823 MSc Computing in Sep2024.
 */

// Global variables
var paused = false;
var msgBuf = [];
const CLIENT_WIDTH = 1920;  
const CLIENT_HEIGHT = 1080;


let socket, svg, g, link, node;
let offsetX, offsetY
let firstLoaded = false
let startTime
let isTopLeft, isTopRight
let originalGraphData = { nodes: [], edges: [] };
let hasDisplayedRange = false;
let usdPrice

let txValFilterApplied = false;  // Initiliased to false, set to true when at least one filter is applied
let balanceFilterApplied = false;  // Initiliased to false, set to true when at least one filter is applied

let highlightedNodesByBalance = new Set();
let highlightedEdgesByBalance = new Set();
let highlightedNodesByTxValue = new Set();
let highlightedEdgesByTxValue = new Set();

// Sorted arrays of nodes
let orderedTxNodesByOutVals = []; // Sorted transaction nodes based on outVals
let orderedNodesByBalance = []; // Sorted input and output nodes based on address balance

// Maps to track which nodes are already added to the lists
const txNodesById = new Map();  // For transaction nodes by outVals
const nodesByBalanceId = new Map();  // For input/output nodes by balance

let currentTxValNodeIndex = 0;
let currentBalanceNodeIndex = 0;
let txValFilteredNodes = [];
let balanceFilteredNodes = [];

let chosenNodes = new Set();
let chosenEdges = new Set();

window.addEventListener("load", init, false);


function init() {
    console.log("Initializing...");
    runWebSocket();
}


function runWebSocket() {
    socket = io(`http://${SOCKET_IP}:3000/`,{
        withCredentials: true,
        }
    )
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
    socket.on('filter_nodes', function(msg){
        const filterType = msg.filterType;
        const percentile = parseFloat(msg.percentile);

        console.log(`Applying filter: ${filterType}, top ${percentile}%`);

        if (filterType === 'transactionValue') {
            applyTransactionValueFilter(percentile);
        } else if (filterType === 'addressBalance') {
            applyAddressBalanceFilter(percentile);
        }
    })
    socket.on('cancel_filter', function(msg){
        const filterType = msg.filterType;
        console.log(`Cancelling filter: ${filterType}`);

        if (filterType === 'transactionValue') {
            cancelTransactionValueFilter();
        } else if (filterType === 'addressBalance') {
            cancelAddressBalanceFilter();
        }
    })
    socket.on('view_transaction_info', function(msg) {
        const filterType = msg.filterType;
        console.log(`Received view transaction info for filter: ${filterType}`);
    
        if (isTopRight) {
            // Ensure the infoBox is visible again when reapplying the filter
            const infoBox = document.getElementById('infoBox');
            infoBox.style.visibility = 'visible';  // Show the infoBox again
            infoBox.style.opacity = '1';  // Restore opacity
        }
        if (filterType === 'transactionValue') {
            // Logic to handle viewing transaction info for transaction value filter
            handleTransactionValueInfo();
        } else if (filterType === 'addressBalance') {
            // Logic to handle viewing transaction info for balance filter
            handleAddressBalanceInfo();
        }
    });
    // Handle navigation for transaction value nodes
    socket.on('navigate_tx_val_node', function(msg) {
        const direction = msg.direction;
        console.log("navigate tx val")
        console.log(direction)
        if (direction === 'previous') {
            currentTxValNodeIndex = (currentTxValNodeIndex - 1 + txValFilteredNodes.length) % txValFilteredNodes.length;
        } else if (direction === 'next') {
            currentTxValNodeIndex = (currentTxValNodeIndex + 1) % txValFilteredNodes.length;
        }

        updateTxValNodeInfo(currentTxValNodeIndex);
    });

    // Handle navigation for address balance nodes
    socket.on('navigate_balance_node', function(msg) {
        const direction = msg.direction;
        console.log("navigate balance")
        console.log(direction)
        if (direction === 'previous') {
            currentBalanceNodeIndex = (currentBalanceNodeIndex - 1 + balanceFilteredNodes.length) % balanceFilteredNodes.length;
        } else if (direction === 'next') {
            currentBalanceNodeIndex = (currentBalanceNodeIndex + 1) % balanceFilteredNodes.length;
        }

        updateBalanceNodeInfo(currentBalanceNodeIndex);
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
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceMax / 10000000).toLocaleString()+ '</span>': 'N/A';
    document.getElementById('balanceMed').innerHTML =(stats.balanceMed !== null && stats.balanceMed !== undefined) ? 
                                                    (stats.balanceMed * 1000 / 100000000).toLocaleString() + ' mB /  ' + 
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceMed / 10000000).toFixed(2).toLocaleString()+ '</span>': 'N/A';
    document.getElementById('balanceIQR').innerHTML = (stats.balanceIQR !== null && stats.balanceMed !== undefined)? 
                                                    (stats.balanceIQR * 1000 / 100000000).toLocaleString() + ' mB /  ' + 
                                                    '<span class="usd-price">$' + (usdPrice * stats.balanceIQR / 10000000).toFixed(2).toLocaleString()+ '</span>': 'N/A';
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
            inVals: d.inVals,
            outVals: d.outVals,
            fee: d.fee,
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

    // Determine if this is the top-left / top-right screen
    isTopLeft = (row === 2 && col === -1);
    isTopRight = (row ===2 && col === 1);

    const infoArea = document.getElementById('infoArea');
    const infoBox = document.getElementById('infoBox')
    if (isTopLeft) {
        infoArea.style.visibility = 'visible';
        infoArea.style.opacity = '1';
    }
    if (isTopRight){
        infoBox.style.visibility = 'visible';
        infoBox.style.opacity = '1';
    }

     offsetX = (col == 0 ? 0 : col * 0.5 * CLIENT_WIDTH);     
     offsetY = (row > 0 ? (row - 1) : (row + 1)) * CLIENT_HEIGHT;

    // Scaling nodes
    const scaleFactorX = 1;
    const scaleFactorY = 1;

    graphData.nodes.forEach(node => {
        node.x = node.x * scaleFactorX;
        node.y = node.y * scaleFactorY;

    // Add node to global ordered lists only if it's not already present
    if (node.type === 'tx') {
        // Check if the node is already in the list by ID
        if (!txNodesById.has(node.id)) {
            txNodesById.set(node.id, node);
            orderedTxNodesByOutVals.push(node);
        }
    } else if (node.type === 'input' || node.type === 'output') {
        // Check if the node is already in the list by ID
        if (!nodesByBalanceId.has(node.id)) {
            nodesByBalanceId.set(node.id, node);
            orderedNodesByBalance.push(node);
        }
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


    let filteredNodes = JSON.parse(JSON.stringify(graphData.nodes)).filter(node => {
        const xInRange = node.x >= xMin && node.x <= xMax;
        const yInRange = node.y >= yMin && node.y <= yMax;
        return xInRange && yInRange;
    });

    // console.log("Filtered nodes:", filteredNodes);

    if (!hasDisplayedRange){
        console.log(`Client x range: [${xMin}, ${xMax}]`);
        console.log(`Client y range: [${yMin}, ${yMax}]`);
        hasDisplayedRange = true;
    }

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

        return sourceInFilteredNodes && targetInFilteredNodes;
    });

    // console.log('Filtered edges:', filteredEdges);

    if (!svg) {
        initializeGraph();
    }

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
    });

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


    // Add new nodes
    const nodeEnter = node.enter().append("circle")
        .attr("class", d => `node node-${d.id}`)
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
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .style("fill", d => {
            if (chosenNodes.has(d.id)) {
                return 'green';
            } 
            else{
                return d.color; 
            }
        })
        .style("opacity", d => {
            if (txValFilterApplied || balanceFilterApplied){
                if (highlightedNodesByTxValue.has(d.id) || highlightedNodesByBalance.has(d.id)) {
                    return 1.0;  // Full opacity for highlighted nodes
                }
                return 0.3;  // Dim unhighlighted nodes
            }
            else{
                return 1.0;
            }
            
        })
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

    const linkEnter = link.enter().append("line")
        .attr("class", "link")
        .style("stroke", d => {
            const sourceId = String(d.source.id);
            const targetId = String(d.target.id);
            // Check if it's an intersection edge
            if (sourceId.includes('intersection_') || targetId.includes('intersection_'))  {
                let originalSource, originalTarget;
                ({originalSource, originalTarget} = getOriginalSourceAndTarget(sourceId, targetId));
    
                // Check if the original source and target exist in chosenEdges
                if (chosenEdges.has(`${originalSource}-${originalTarget}`) || chosenEdges.has(`${originalTarget}-${originalSource}`)) {
                    return 'green';  // Highlight the intersection edge
                }
            }
            if (chosenEdges.has(`${d.source.id}-${d.target.id}`)) {
                return 'green'; 
            }
            else{
                return d.color;
            }
        })
        .style("stroke-opacity", d => {
            if (txValFilterApplied || balanceFilterApplied){
                const sourceId = String(d.source.id);
                const targetId = String(d.target.id);
                // Check if it's an intersection edge
                if (sourceId.includes('intersection_') || targetId.includes('intersection_')) {
                    let originalSource, originalTarget;
                    ({originalSource, originalTarget} = getOriginalSourceAndTarget(sourceId, targetId));
                    
                    if (highlightedEdgesByBalance.has(`${originalSource}-${originalTarget}`) || highlightedEdgesByTxValue.has(`${originalSource}-${originalTarget}`)) {
                        return 1.0;  // Full opacity for highlighted intersection edges
                    }
                }
                if (highlightedEdgesByBalance.has(`${d.source.id}-${d.target.id}`) || highlightedEdgesByTxValue.has(`${d.source.id}-${d.target.id}`)) {
                    return 1.0;  // Full opacity for highlighted edges
                }
                return 0.5;  // Dim unhighlighted edges
            }
            else{
                return 1.0;
            }
            
        })
        .style("stroke-width", d => {
            if (d.type === 'addr_link') {
                return 0.3;
            } else {
                const iqr = d.iqr_score_tx || 0.5;
                const strokeWidth = mapIqrScoreToThickness(iqr);
                return strokeWidth
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

// Helper function that gets the original source and target of an intersection edge
function getOriginalSourceAndTarget(sourceId, targetId){
    let originalSource, originalTarget;

    if (sourceId.includes('intersection_')) {
        const parts = sourceId.split('_');
        originalSource = parts[1];
        originalTarget = parts[2];
    } else if (targetId.includes('intersection_')) {
        const parts = targetId.split('_');
        originalSource = parts[1];
        originalTarget = parts[2];
    }
    return {originalSource, originalTarget}
}


// Function to apply transaction value filter
function applyTransactionValueFilter(percentile) {
    console.log(`Applying transaction value filter for top ${percentile}%`);

    txValFilterApplied = true

     // Clear the sets before applying a new filter
     highlightedNodesByTxValue.clear();
     highlightedEdgesByTxValue.clear(); 

    // Get the threshold value for the top percentile of transaction values
    const sortedTransactions = [...orderedTxNodesByOutVals];
    const thresholdIndex = Math.ceil(sortedTransactions.length * (percentile / 100));
    const thresholdValue = sortedTransactions[thresholdIndex - 1].outVals;

    originalGraphData.nodes.forEach(node => {
        if (node.type === 'tx' && node.outVals >= thresholdValue) {
            // Highlight the transaction node
            highlightedNodesByTxValue.add(node.id); 

            // Highlight connected edges and input/output nodes
            originalGraphData.edges.forEach(edge => {
                if (edge.source === node.id || edge.target === node.id) {
                    highlightedEdgesByTxValue.add(`${edge.source}-${edge.target}`);

                    // Highlight input/output nodes connected to this transaction node
                    const connectedNodeId = edge.source === node.id ? edge.target : edge.source;
                    highlightedNodesByTxValue.add(connectedNodeId)
                }
            });
        }
    });

    // Update the graph to reflect the highlighted nodes
    updateOpacityForAllNodesAndEdges();
    clearInfoBox();
}

// Function to apply address balance filter
function applyAddressBalanceFilter(percentile) {
    console.log(`Applying address balance filter for top ${percentile}%`);

    balanceFilterApplied = true

    // Clear the sets before applying a new filter
    highlightedNodesByBalance.clear();
    highlightedEdgesByBalance.clear();

    // Get the threshold value for the top percentile of address balances
    const sortedAddresses = [...orderedNodesByBalance];
    const thresholdIndex = Math.ceil(sortedAddresses.length * (percentile / 100));
    const thresholdBalance = sortedAddresses[thresholdIndex - 1].balance;

    originalGraphData.nodes.forEach(node => {
        if ((node.type === 'input' || node.type === 'output') && node.balance >= thresholdBalance){
            // Highlight the node
            highlightedNodesByBalance.add(node.id); 

            // Highlight the edge connected to this input/output node
            originalGraphData.edges.forEach(edge => {
                if (edge.source === node.id || edge.target === node.id) {
                    highlightedEdgesByBalance.add(`${edge.source}-${edge.target}`);
                }
            });
        }
    });

    // Update the graph to reflect the highlighted nodes
    updateOpacityForAllNodesAndEdges();
    clearInfoBox();
}

// Function to cancel the transaction value filter
function cancelTransactionValueFilter(){
    console.log(`Cancelling transaction value filter`);

    txValFilterApplied = false

    highlightedNodesByTxValue.clear();
    highlightedEdgesByTxValue.clear(); 

    updateOpacityForAllNodesAndEdges();
    resetChosenNodesAndEdges();
    clearInfoBox();
}

// Function to cancel the address balance filter
function cancelAddressBalanceFilter(){
    console.log(`Cancelling address balance filter`);

    balanceFilterApplied = false

    highlightedNodesByBalance.clear();
    highlightedEdgesByBalance.clear(); 

    updateOpacityForAllNodesAndEdges();
    resetChosenNodesAndEdges();
    clearInfoBox();
}

// Function to update the opacity for all nodes and edges based on filter states
function updateOpacityForAllNodesAndEdges() {
    // Update nodes
    d3.selectAll('circle.node')
        .style('opacity', function(d) {
            if (txValFilterApplied || balanceFilterApplied) {
                if (highlightedNodesByTxValue.has(d.id) || highlightedNodesByBalance.has(d.id)) {
                    return 1.0;  // Highlighted nodes at full opacity
                }
                return 0.2;  // Dim unhighlighted nodes
            } else {
                return 1.0;  // Full opacity when no filter is applied
            }
        });

    // Update edges
    d3.selectAll('line.link')
        .style('stroke-opacity', function(d) {
            if (txValFilterApplied || balanceFilterApplied) {
                if (highlightedEdgesByBalance.has(`${d.source.id}-${d.target.id}`) || highlightedEdgesByTxValue.has(`${d.source.id}-${d.target.id}`)) {
                    return 1.0;  // Highlighted edges at full opacity
                }
                return 0.2;  // Dim unhighlighted edges
            } else {
                return 1.0;  // Full opacity when no filter is applied
            }
        });
}


// Function to handle transaction value information
function handleTransactionValueInfo() {
    // Get all highlighted nodes of type 'tx' for transaction value
    txValFilteredNodes = Array.from(highlightedNodesByTxValue).filter(nodeId => {
        const node = originalGraphData.nodes.find(n => n.id === nodeId);
        return node && node.type === 'tx';
    });

    if (txValFilteredNodes.length === 0) {
        console.log("No transaction nodes found in the filtered set.");
        return;
    }

    // Sort the filtered nodes by `outVals` in descending order
    txValFilteredNodes.sort((a, b) => {
        const nodeA = originalGraphData.nodes.find(n => n.id === a);
        const nodeB = originalGraphData.nodes.find(n => n.id === b);
        return nodeB.outVals - nodeA.outVals;
    });

    // Show the first node's information
    currentTxValNodeIndex = 0;
    showTransactionValueInfo(txValFilteredNodes[currentTxValNodeIndex]);
}

// Function to show transaction value information
function showTransactionValueInfo(nodeId) {
    console.log("updating transaction value info")
    const node = originalGraphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Display node information (size, inVals, outVals, fee)
    const infoBox = document.getElementById('infoBox');
    infoBox.innerHTML = `
        <h3>Transaction Node Info</h3>
        <p>Node ID: ${node.id}</p>
        <p>Size: ${node.size} bytes</p>
        <p>inVals: ${(node.inVals * 1000 / 10000000).toLocaleString()} mB / $${(usdPrice * node.inVals / 10000000).toFixed(2).toLocaleString()}</p>
        <p>outVals: ${(node.outVals * 1000 / 10000000).toLocaleString()} mB / $${(usdPrice * node.outVals / 10000000).toFixed(2).toLocaleString()}</p>
        <p>Fee: ${(node.fee * 1000 / 10000000).toLocaleString()} mB / $${(usdPrice * node.fee / 10000000).toFixed(2).toLocaleString()}</p>
    `;

    // Highlight the current node and its connected edges and nodes
    resetChosenNodesAndEdges();
    highlightTransactionNode(node);
}

// Highlight the current transaction node and connected components
function highlightTransactionNode(node) {
    console.log("Highlight transaction node")
    chosenNodes.add(node.id);

    // Highlight connected edges and input/output nodes
    originalGraphData.edges.forEach(edge => {
        if (edge.source === node.id || edge.target === node.id) {
            chosenEdges.add(`${edge.source}-${edge.target}`);

            const connectedNodeId = edge.source === node.id ? edge.target : edge.source;
            chosenNodes.add(connectedNodeId);
        }
    });

    renderChosenNodesEdgesGreen()
}

// Function to handle address balance information
function handleAddressBalanceInfo() {
    // Get all highlighted nodes of type 'input' or 'output'
    balanceFilteredNodes = Array.from(highlightedNodesByBalance);

    if (balanceFilteredNodes.length === 0) {
        console.log("No input/output nodes found in the filtered set.");
        return;
    }

    // Sort the filtered nodes by `balance` in descending order
    balanceFilteredNodes.sort((a, b) => {
        const nodeA = originalGraphData.nodes.find(n => n.id === a);
        const nodeB = originalGraphData.nodes.find(n => n.id === b);
        return nodeB.balance - nodeA.balance;
    });

    // Show the first node's information
    currentBalanceNodeIndex = 0;
    showAddressBalanceInfo(balanceFilteredNodes[currentBalanceNodeIndex]);
}

// Function to show address balance information
function showAddressBalanceInfo(nodeId) {
    console.log("Updating address balance info")
    const node = originalGraphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Display node information
    const nodeTypeTitle = node.type === 'input' ? 'Input Node Info' : 'Output Node Info';
    const connectedEdge = originalGraphData.edges.find(edge => edge.source === node.id || edge.target === node.id);
    const edgeSize = connectedEdge ? connectedEdge.size : 'N/A';

    const infoBox = document.getElementById('infoBox');
    infoBox.innerHTML = `
        <h3>${nodeTypeTitle}</h3>
        <p>Node ID: ${node.id}</p>
        <p>Balance size: ${(node.balance * 1000 / 10000000).toLocaleString()} mB / $${(usdPrice * node.balance / 10000000).toFixed(2).toLocaleString()}</p>
        <p>Value: ${(edgeSize * 1000 / 10000000).toLocaleString()} mB  / $${(usdPrice * node.balance / 10000000).toFixed(2).toLocaleString()}</p>
    `;

    // Highlight the current node and its connected edge
    resetChosenNodesAndEdges();
    highlightAddressNode(node, connectedEdge);
}


// Highlight the current address node and its connected edge
function highlightAddressNode(node, edge) {
    console.log("Highlighting: ", node.id, `${edge.source}-${edge.target}`)
    chosenNodes.add(node.id);
    if (edge) {
        chosenEdges.add(`${edge.source}-${edge.target}`);
    }

    renderChosenNodesEdgesGreen();  // Re-render graph with updated highlights
}

// Function to update the colour of the currently chosen nodes and edges green
function renderChosenNodesEdgesGreen() {
    node.style("fill", d => {
        if (chosenNodes.has(d.id)) {
            return 'green';  // Highlight chosen nodes in green
        }
        return d.color;  // Keep original color for other nodes
    })

    // Update edge appearance based on the chosen set
    link.style("stroke", d => {
        const edgeId = `${d.source.id}-${d.target.id}`;
        if (chosenEdges.has(edgeId)) {
            return 'green';  // Highlight chosen edges in green
        }
        return d.color;  // Keep original color for other edges
    })
}

function resetChosenNodesAndEdges(){
    // Clear the sets for chosen nodes and edges
    chosenNodes.clear();
    chosenEdges.clear();

    // Reset the color for all nodes and edges to their original colors
    node.style("fill", d => d.color)
    link.style("stroke", d => d.color)
}

function clearInfoBox(){
    // Clear and hide the info box
    const infoBox = document.getElementById('infoBox');
    infoBox.innerHTML = '';  // Clear the content
    infoBox.style.opacity = '0';  // Hide the info box
}

// Function to show transaction information for the current index in the list
function updateTxValNodeInfo(index) {
    console.log("updateTxValNodeInfo")
    console.log(index)
    if (txValFilteredNodes.length > 0) {
        const nodeId = txValFilteredNodes[index];
        showTransactionValueInfo(nodeId);  // Update the display
    }
}

// Function to show address balance information for the current index in the list
function updateBalanceNodeInfo(index) {
    console.log("updateBalanceNodeInfo")
    console.log(index)
    if (balanceFilteredNodes.length > 0) {
        const nodeId = balanceFilteredNodes[index];
        showAddressBalanceInfo(nodeId);  // Update the display
    }
}


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
            .domain([20, 300]) 
            .range([3.5, maxThickness])
            .clamp(true);
        
        thickness = ExtremeValueScale(iqrScore);
    }
    return thickness
}

function mapIqrScoreToRadius(iqrScore) {
    const minRadius = 1.0;
    const medRadius = 2.5;
    const maxRadius = 6.5;

    let radius;

    if (iqrScore <= 1) {
        const linearScale = d3.scaleLinear()
            .domain([-1, 0, 1])
            .range([minRadius, 1.0, medRadius])
            .clamp(true);
        
        radius = linearScale(iqrScore);
    } else if (iqrScore > 1 && iqrScore <= 20){
        const largeValueScale = d3.scaleLinear()
            .domain([1, 300]) 
            .range([medRadius, 3.5])
            .clamp(true);
        
        radius = largeValueScale(iqrScore);
    }
    else{
        const ExtremeValueScale = d3.scaleLinear()
            .domain([300, 3000])  
            .range([3.5, maxRadius])
            .clamp(true);
        
        radius = ExtremeValueScale(iqrScore);
    }
    return radius
}


function ticked() {
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


// Function to display transaction values for edges and address balance for nodes when hovering on
// Used for testing locally
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