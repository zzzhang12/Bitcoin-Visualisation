// Global variables
var isHovered = false;
var paused = false;
var msgBuf = [];
var minDegs = 0;
var minValConstraint = 0;
var maxValConstraint = Number.MAX_VALUE;
var minFeeConstraint = 0;
var maxFeeConstraint = Number.MAX_VALUE;
var addrFilter = '';
var txFilter = '';

var currUSDBTC = 0;
var txRate = 0;
var lastRateTx = 0;
var timeOfLastTx = Date.now();

var numTx = 0;
var numIn = 0;
var numOut = 0;
var numNodes = 0;

var txMaxVal = 0;
var txTotalVal = 0;

var txMaxFee = 0;
var txTotalFee = 0;

var txMaxSize = 0;
var txTotalSize = 0;

var blkTimer = null;

let socket;

window.addEventListener("load", init, false);

function init() {
    console.log("Initializing...");
    runWebSocket();
}

function runWebSocket() {
    console.log("`Setting up websocket")
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

    socket.on('connect_error', function(error) {
        console.log('Connection Error:', error);
    });

    socket.on('connect_timeout', function(timeout) {
        console.log('Connection Timeout:', timeout);
    });
};


function processMessage(msg){
    if (paused) {
        msgBuf.push(msg);
    }
    else {
        renderGraph(msg);
    }
}

// d3.json("/static/graph_data.json").then(function(graphData) {
//     renderGraph(graphData);
// }).catch(function(error) {
//     console.error("Error loading the graph data: ", error);
// });

function renderGraph(graphData) {
    console.log("Attempting to render graph");
    console.log("Received graph data structure:", graphData);

    if (!graphData || !Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
        console.error("Graph data is not correctly structured:", graphData);
        return;
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    const svg = d3.select("svg")
        .call(d3.zoom().on("zoom", ({ transform }) => {
            g.attr("transform", transform);
        }))
        .append("g");

    const g = svg.append("g");

    const link = g.selectAll(".link")
        .data(graphData.edges, d => `${d.source}-${d.target}`)
        .enter().append("line")
        .attr("class", "link")
        .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399");

    const node = g.selectAll(".node")
        .data(graphData.nodes, d => d.id)
        .enter().append("circle")
        .attr("class", "node")
        .attr("r", d => d.type === 'tx' ? 6 : 1)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .style("fill", d => d.color)
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded))
        .on("click", focusOnNode);

    const simulation = d3.forceSimulation(graphData.nodes)
        .force("link", d3.forceLink(graphData.edges).id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-30))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => d.type === 'tx' ? 15 : 10))
        .on("tick", ticked);

    setTimeout(() => {
        simulation.stop();
    }, 2000);

    function ticked() {
        link
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        node
            .attr("cx", d => d.x)
            .attr("cy", d => d.y);
    }

    function dragStarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragEnded(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    function focusOnNode(event, d) {
        const scale = 3.5;
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(scale)
            .translate(-d.x, -d.y);
        svg.transition().duration(750).call(d3.zoom().transform, transform);
    }

    socket.on('graph_data', function(newGraphData) {
        console.log("Received graph data:", newGraphData);
        updateGraph(newGraphData);
    });

    function updateGraph(newGraphData) {
        console.log("Updating graph with new data:", newGraphData);

        if (!Array.isArray(newGraphData.nodes) || !Array.isArray(newGraphData.edges)) {
            console.error("New graph data is not correctly structured:", newGraphData);
            return;
        }

        const newNodes = g.selectAll(".node")
            .data(newGraphData.nodes, d => d.id);

        newNodes.enter().append("circle")
            .attr("class", "node")
            .attr("r", d => d.type === 'tx' ? 6 : 1)
            .attr("cx", d => d.x)
            .attr("cy", d => d.y)
            .style("fill", d => d.color)
            .call(d3.drag()
                .on("start", dragStarted)
                .on("drag", dragged)
                .on("end", dragEnded))
            .on("click", focusOnNode);

        const newLinks = g.selectAll(".link")
            .data(newGraphData.edges, d => `${d.source}-${d.target}`);

        newLinks.enter().append("line")
            .attr("class", "link")
            .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399");

        simulation.nodes(simulation.nodes().concat(newGraphData.nodes));
        simulation.force("link").links(simulation.force("link").links().concat(newGraphData.edges));
        simulation.alpha(1).restart();
    }
}
// }
// function renderGraph(graphData) {
//     console.log("Attempting to render graph");
//     const width = window.innerWidth;
//     const height = window.innerHeight;

//     const svg = d3.select("svg")
//         .call(d3.zoom().on("zoom", ({transform}) => {
//             g.attr("transform", transform);
//         }))
//         .append("g");

//     const g = svg.append("g");

//     const link = g.selectAll(".link")
//         .data(graphData.edges)
//         .enter().append("line")
//         .attr("class", "link")
//         .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399");

//     const node = g.selectAll(".node")
//         .data(graphData.nodes)
//         .enter().append("circle")
//         .attr("class", "node")
//         .attr("r", d => d.type === 'tx' ? 10 : 5)  // Larger size for transaction nodes, smaller for input/output nodes
//         .attr("cx", d => d.x)
//         .attr("cy", d => d.y)
//         .style("fill", d => d.color)
//         .call(d3.drag()
//             .on("start", dragStarted)
//             .on("drag", dragged)
//             .on("end", dragEnded))
//         .on("click", focusOnNode);  // Add click event for focusing

//     const simulation = d3.forceSimulation(graphData.nodes)
//         .force("link", d3.forceLink(graphData.edges).id(d => d.id).distance(100))
//         .force("charge", d3.forceManyBody().strength(-30))
//         .force("center", d3.forceCenter(width / 2, height / 2))
//         .force("collision", d3.forceCollide().radius(d => d.type === 'tx' ? 15 : 10))
//         .on("tick", ticked);

//     // Stop the simulation after the initial adjustment
//     setTimeout(() => {
//         simulation.stop();
//     }, 2000);

//     function ticked() {
//         link
//             .attr("x1", d => d.source.x)
//             .attr("y1", d => d.source.y)
//             .attr("x2", d => d.target.x)
//             .attr("y2", d => d.target.y);

//         node
//             .attr("cx", d => d.x)
//             .attr("cy", d => d.y);
//     }

//     function dragStarted(event, d) {
//         if (!event.active) simulation.alphaTarget(0.3).restart();
//         d.fx = d.x;
//         d.fy = d.y;
//     }

//     function dragged(event, d) {
//         d.fx = event.x;
//         d.fy = event.y;
//     }

//     function dragEnded(event, d) {
//         if (!event.active) simulation.alphaTarget(0);
//         d.fx = null;
//         d.fy = null;
//     }

//     function focusOnNode(event, d) {
//         const scale = 2.5;  // Increased scale for more noticeable zoom
//         const transitionDuration = 1000;  // Increased duration for more noticeable transition
//         const transform = d3.zoomIdentity
//             .translate(width / 2, height / 2)
//             .scale(scale)
//             .translate(-d.x, -d.y);
//         svg.transition().duration(transitionDuration).call(d3.zoom().transform, transform);
//     }

// }