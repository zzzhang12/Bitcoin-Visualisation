// Global variables
var paused = false;
var msgBuf = [];
const CLIENT_WIDTH = 853;  
const CLIENT_HEIGHT = 982;

let socket, svg, g, link, node, simulation;
let offsetX, offsetY

window.addEventListener("load", init, false);


function init() {
    console.log("Initializing...");
    runWebSocket();
}


function runWebSocket() {
    socket = io("http://localhost:3000",{
        withCredentials: true,
        // transports: ['websocket', 'polling']
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
        processMessage(msg);
    });

    socket.on('connection_response', function(msg) {
        console.log('Server response:', msg);
    });
};


function getUrlParameter(name) {
    name = name.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]');
    var regex = new RegExp('[\\?&]' + name + '=([^&#]*)');
    var results = regex.exec(location.search);
    return results === null ? '' : decodeURIComponent(results[1].replace(/\+/g, ' '));
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

    // simulation = d3.forceSimulation()
    //     .force("link", d3.forceLink().id(d => d.id).distance(100))
    //     .force("charge", d3.forceManyBody().strength(-30))
    //     .force("center", d3.forceCenter(width / 2, height / 2))
    //     .force("collision", d3.forceCollide().radius(d => d.type === 'tx' ? 15 : 10))
    //     .on("tick", ticked);
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

     // Calculate offsets based on col and row
     offsetX = (col > 0 ? (col - 1) : (col + 1)) * CLIENT_WIDTH;
     offsetY = (row > 0 ? (row - 1) : (row + 1)) * CLIENT_HEIGHT;

     offsetX = 0 
     offsetY = 0  // uncomment when testing only 1 client

    // Scaling nodes
    const scaleFactorX = 5;
    const scaleFactorY = 5;

    graphData.nodes.forEach(node => {
        node.x = node.x * scaleFactorX;
        node.y = node.y * scaleFactorY;
    });

    
    // Calculate the filtered nodes based on the client viewport
    let filteredNodes = graphData.nodes.filter(node => {
        const xInRange = col > 0 ? (node.x >= offsetX && node.x <= (offsetX + CLIENT_WIDTH)) : (node.x < offsetX && node.x >= (offsetX - CLIENT_WIDTH));
        const yInRange = row > 0 ? (node.y >= offsetY && node.y <= (offsetY + CLIENT_HEIGHT)) : (node.y < offsetY && node.y >= (offsetY - CLIENT_HEIGHT));
        // console.log(`Checking node ${node.id} at (${node.x}, ${node.y}): xInRange = ${xInRange}, yInRange = ${yInRange}`);
        return xInRange && yInRange;
    });

    // console.log("Filtered nodes:", filteredNodes);

    console.log(`Client offset (x, y): (${offsetX}, ${offsetY})`);
    // console.log(`Client x range: [${offsetX}, ${offsetX + CLIENT_WIDTH}]`);
    // console.log(`Client y range: [${offsetY}, ${offsetY + CLIENT_HEIGHT}]`);
    
    // Filter edges based on the filtered nodes
    const filteredEdges = graphData.edges.filter(edge => {
        const sourceInFilteredNodes = filteredNodes.find(node => node.id === edge.source);
        const targetInFilteredNodes = filteredNodes.find(node => node.id === edge.target);

        // console.log(`Edge from ${edge.source} to ${edge.target} - source in filtered nodes: ${!!sourceInFilteredNodes}, target in filtered nodes: ${!!targetInFilteredNodes}`);

        return sourceInFilteredNodes && targetInFilteredNodes;
    });

    // console.log('Filtered edges:', filteredEdges);

    if (!svg) {
        initializeGraph();
    }

    // Convert edges to reference the node objects
    const nodeById = new Map(graphData.nodes.map(d => [d.id, d]));
    graphData.edges.forEach(d => {
        d.source = nodeById.get(d.source);
        d.target = nodeById.get(d.target);
    });

    updateGraph(graphData);  // for testing with only client
    // updateGraph({nodes: filteredNodes, edges: filteredEdges});
}


function updateGraph(newGraphData) {
    // console.log("Updating graph with new data:", newGraphData);

    if (!Array.isArray(newGraphData.nodes) || !Array.isArray(newGraphData.edges)) {
        console.error("New graph data is not correctly structured:", newGraphData);
        return;
    }

    const existingNodes = new Set(node.data().map(d => d.id));

    const nodesToAdd = newGraphData.nodes.filter(node => !existingNodes.has(node.id));
    const linksToAdd = newGraphData.edges;
    const nodesToUpdate = newGraphData.nodes.filter(node => existingNodes.has(node.id));

    console.log("number of nodesToAdd: ", nodesToAdd.length)
    // Update positions of existing nodes
    nodesToUpdate.forEach(updatedNode => {
        const nodeToUpdate = node.data().find(d => d.id === updatedNode.id);
        nodeToUpdate.x = updatedNode.x;
        nodeToUpdate.y = updatedNode.y;
    });

    // Update node data with new nodes
    node = node.data(node.data().concat(nodesToAdd), d => d.id);
    node.exit().remove();

    node = node.enter().append("circle")
        .attr("class", "node")
        .attr("r", d => d.type === 'tx' ? 3 : 0.5)
        // .attr("r", d => 6)  // for testing intersection nodes
        .attr("cx", d => d.x - offsetX)
        .attr("cy", d => d.y - offsetY)
        .style("fill", d => d.color)
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded))
        // .on("click", focusOnNode)
        .on("click", function(event, d) {
            document.getElementById('infoBox').innerText = `Node ID: ${d.id}`;
        })
        .merge(node);

    // Update link data with new links
    link = link.data(link.data().concat(linksToAdd), d => `${d.source}-${d.target}`);
    link.exit().remove();

    link = link.enter().append("line")
        .attr("class", "link")
        .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399")
        .style("stroke-width", 0.5) 
        .merge(link);

    // Separate nodes into movable and static groups
    const movableNodes = node.filter(d => d.type !== 'intersection');
    const staticNodes = node.filter(d => d.type === 'intersection');

    // simulation = d3.forceSimulation(movableNodes.data())
    //     .force("link", d3.forceLink(newGraphData.edges).id(d => d.id).distance(50))
    //     .force("charge", d3.forceManyBody().strength(-100))
    //     .force("center", d3.forceCenter((window.innerWidth / 2) - offsetX, (window.innerHeight / 2) - offsetY))
    //     .force("collision", d3.forceCollide().radius(d => d.type === 'tx' ? 20 : 5))
    //     .on("tick", ticked);
    ticked();

    // simulation.nodes(node.data());
    // simulation.force("link").links(link.data());
    // simulation.alpha(1).restart();
}

function ticked() {
    // node.each(function(d) {
    //     console.log(`Node ${d.id} position during tick: (${d.x}, ${d.y})`);
    // });
    link
        .attr("x1", d => d.source.x - offsetX)
        .attr("y1", d => d.source.y - offsetY)
        .attr("x2", d => d.target.x - offsetX)
        .attr("y2", d => d.target.y - offsetY);

    node
        .attr("cx", d => d.x - offsetX)
        .attr("cy", d => d.y - offsetY);
}

function dragStarted(event, d) {
    // if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;

    // Move connected nodes
    node.each(function(n) {
        if (n.id !== d.id && isConnected(d, n)) {
            n.fx = event.x;
            n.fy = event.y;
        }
    });
    simulation.alpha(1).restart();
}

function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;

    // Unfix connected nodes
    node.each(function(n) {
        if (n.id !== d.id && isConnected(d, n)) {
            n.fx = null;
            n.fy = null;
        }
    });
}

// function dragStarted(event, d) {
//     d3.select(this).raise().attr("stroke", "black");
// }


// function dragged(event, d) {
//     d.x = event.x;
//     d.y = event.y;

//     d3.select(this)
//         .attr("cx", d.x - offsetX)
//         .attr("cy", d.y - offsetY);

//     updateConnectedNodesAndLinks();
// }

// function dragEnded(event, d) {
//     d3.select(this).attr("stroke", null);
// }

// function updateConnectedNodesAndLinks() {
//     node.each(function(d) {
//         d3.select(this)
//             .attr("cx", d.x - offsetX)
//             .attr("cy", d.y - offsetY);
//     });

//     link.each(function(d) {
//         d3.select(this)
//             .attr("x1", d.source.x - offsetX)
//             .attr("y1", d.source.y - offsetY)
//             .attr("x2", d.target.x - offsetX)
//             .attr("y2", d.target.y - offsetY);
//     });
// }


// function focusOnNode(event, d) {
//     const scale = 3.5;
//     const transform = d3.zoomIdentity
//         .translate(window.innerWidth / 2, window.innerHeight / 2)
//         .scale(scale)
//         .translate(-d.x, -d.y);
//     svg.transition().duration(750).call(d3.zoom().transform, transform);
// }

function isConnected(a, b) {
    return link.data().some(d => (d.source.id === a.id && d.target.id === b.id) || (d.source.id === b.id && d.target.id === a.id));
}