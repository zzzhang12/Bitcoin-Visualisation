// Global variables
var paused = false;
var msgBuf = [];

let socket, svg, g, link, node, simulation;


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


function processMessage(msg){
    if (paused) {
        msgBuf.push(msg);
    }
    else {
        renderGraph(msg);
    }
}

// d3.json("graph_data.json").then(function(graphData) {
//     renderGraph(graphData);
// }).catch(function(error) {
//     console.error("Error loading the graph data: ", error);
// });


function initializeGraph() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    svg = d3.select("svg")
        .call(d3.zoom().on("zoom", ({ transform }) => {
            g.attr("transform", transform);
        }))
        .append("g");

    g = svg.append("g");

    link = g.selectAll(".link");
    node = g.selectAll(".node");

    simulation = d3.forceSimulation()
        .force("link", d3.forceLink().id(d => d.id).distance(100))
        .force("charge", d3.forceManyBody().strength(-30))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("collision", d3.forceCollide().radius(d => d.type === 'tx' ? 15 : 10))
        .on("tick", ticked);
}


function renderGraph(graphData) {
    console.log("Attempting to render graph");
    console.log("Received graph data structure:", graphData);

    if (!Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
        console.error("Graph data is not correctly structured:", graphData);
        return;
    }

    if (!svg) {
        initializeGraph();
    }

    updateGraph(graphData);
}


function updateGraph(newGraphData) {
    console.log("Updating graph with new data:", newGraphData);

    if (!Array.isArray(newGraphData.nodes) || !Array.isArray(newGraphData.edges)) {
        console.error("New graph data is not correctly structured:", newGraphData);
        return;
    }

    const existingNodes = new Set(node.data().map(d => d.id));

    const nodesToAdd = newGraphData.nodes.filter(node => !existingNodes.has(node.id));
    const linksToAdd = newGraphData.edges;

    node = node.data(node.data().concat(nodesToAdd), d => d.id);
    node.exit().remove();

    node = node.enter().append("circle")
        .attr("class", "node")
        .attr("r", d => d.type === 'tx' ? 6 : 1)
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .style("fill", d => d.color)
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded))
        .on("click", focusOnNode)
        .merge(node);

    link = link.data(link.data().concat(linksToAdd), d => `${d.source}-${d.target}`);
    link.exit().remove();

    link = link.enter().append("line")
        .attr("class", "link")
        .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399")
        .merge(link);

    simulation.nodes(node.data());
    simulation.force("link").links(link.data());
    simulation.alpha(1).restart();
}

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

function focusOnNode(event, d) {
    const scale = 3.5;
    const transform = d3.zoomIdentity
        .translate(window.innerWidth / 2, window.innerHeight / 2)
        .scale(scale)
        .translate(-d.x, -d.y);
    svg.transition().duration(750).call(d3.zoom().transform, transform);
}

function isConnected(a, b) {
    return link.data().some(d => (d.source.id === a.id && d.target.id === b.id) || (d.source.id === b.id && d.target.id === a.id));
}