// Global variables
var paused = false;
var msgBuf = [];
const CLIENT_WIDTH = 300;  
const CLIENT_HEIGHT = 300;

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

d3.json("static/test_data_2.json").then(function(graphData) {
    renderGraph(graphData);
}).catch(function(error) {
    console.error("Error loading the graph data: ", error);
});


// Function to calculate the intersection point with the canvas boundary
function calculateIntersection(sourceNode, targetNode, offsetX, offsetY, clientWidth, clientHeight) {
    const x1 = sourceNode.x, y1 = sourceNode.y, x2 = targetNode.x, y2 = targetNode.y;
    const boundaries = [
        {x: offsetX, y: offsetY},                             // left boundary
        {x: offsetX + clientWidth, y: offsetY},               // right boundary
        {x: offsetX, y: offsetY + clientHeight},              // bottom boundary
        {x: offsetX + clientWidth, y: offsetY + clientHeight} // top boundary
    ];

    let intersections = [];

    // Check intersections with the four boundaries of the canvas
    for (const boundary of boundaries) {
        let intersection = null;

        // Intersect with vertical boundaries
        if (boundary.x === offsetX || boundary.x === offsetX + clientWidth) {
            const t = (boundary.x - x1) / (x2 - x1);
            const y = y1 + t * (y2 - y1);
            if (y >= offsetY && y <= offsetY + clientHeight) {
                intersection = {x: boundary.x, y: y};
            }
        }

        // Intersect with horizontal boundaries
        if (boundary.y === offsetY || boundary.y === offsetY + clientHeight) {
            const t = (boundary.y - y1) / (y2 - y1);
            const x = x1 + t * (x2 - x1);
            if (x >= offsetX && x <= offsetX + clientWidth) {
                intersection = {x: x, y: boundary.y};
            }
        }

        if (intersection) {
            intersections.push(intersection);
        }
    }

    if (intersections.length > 0) {
        return intersections[0]; // Return the first intersection point found
    }

    return null;
}

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

    const row = parseInt(getUrlParameter('row'), 10);
    const col = parseInt(getUrlParameter('col'), 10);

     // Calculate offsets based on col and row
     offsetX = (col > 0 ? (col - 1) : (col + 1)) * CLIENT_WIDTH;
     offsetY = (row > 0 ? (row - 1) : (row + 1)) * CLIENT_HEIGHT;

    // Calculate the filtered nodes based on the client viewport
    let filteredNodes = graphData.nodes.filter(node => {
        const xInRange = col > 0 ? (node.x >= offsetX && node.x < (offsetX + CLIENT_WIDTH)) : (node.x < offsetX && node.x >= (offsetX - CLIENT_WIDTH));
        const yInRange = row > 0 ? (node.y >= offsetY && node.y < (offsetY + CLIENT_HEIGHT)) : (node.y < offsetY && node.y >= (offsetY - CLIENT_HEIGHT));
        console.log(`Checking node ${node.id} at (${node.x}, ${node.y}): xInRange = ${xInRange}, yInRange = ${yInRange}`);
        return xInRange && yInRange;
    });

    console.log("Filtered nodes:", filteredNodes);

    // console.log(`Client row: ${row}, column: ${col}`);
    // console.log(`Client dimensions (width x height): ${clientWidth} x ${clientHeight}`);
    console.log(`Client offset (x, y): (${offsetX}, ${offsetY})`);
    // console.log(`Client x range: [${offsetX}, ${offsetX + CLIENT_WIDTH}]`);
    // console.log(`Client y range: [${offsetY}, ${offsetY + CLIENT_HEIGHT}]`);

    // // Create a map for quick node lookup
    // const nodesMap = new Map();
    // graphData.nodes.forEach(node => nodesMap.set(node.id, node));

    // const filteredEdges = [];

    // // Check edges and calculate intersections
    // graphData.edges.forEach(edge => {
    //     const sourceNode = nodesMap.get(edge.source);
    //     const targetNode = nodesMap.get(edge.target);

    //     if (filteredNodes.includes(sourceNode) && filteredNodes.includes(targetNode)) {
    //         filteredEdges.push(edge);
    //     } else if (filteredNodes.includes(sourceNode) || filteredNodes.includes(targetNode)) {
    //         const intersection = calculateIntersection(sourceNode, targetNode, offsetX, offsetY, clientWidth, clientHeight);

    //         if (intersection) {
    //             const intersectionId = `intersection_${sourceNode.id}_${targetNode.id}`;
    //             nodesMap.set(intersectionId, intersection);

    //             if (filteredNodes.includes(sourceNode)) {
    //                 filteredEdges.push({source: edge.source, target: intersectionId, type: edge.type});
    //             } else {
    //                 filteredEdges.push({source: intersectionId, target: edge.target, type: edge.type});
    //             }
    //         }
    //     }
    // });

    // console.log("Filtered edges:", filteredEdges);


    // // Filter nodes based on the client's width, height, and offset
    // const filteredNodes = graphData.nodes.filter(node => {
    //     const withinXRange = node.x >= offsetX - TOTAL_WIDTH / 2 && node.x < (offsetX - TOTAL_WIDTH / 2 + clientWidth);
    //     const withinYRange = node.y >= offsetY - TOTAL_HEIGHT / 2 && node.y < (offsetY - TOTAL_HEIGHT / 2 + clientHeight);
    //     return withinXRange && withinYRange;
    // });

    // console.log('Filtered nodes:', filteredNodes);

    // const filteredEdges = [];
    // const intersectionNodes = {};

    // graphData.edges.forEach(edge => {
    //     const sourceNode = graphData.nodes.find(node => node.id === edge.source);
    //     const targetNode = graphData.nodes.find(node => node.id === edge.target);

    //     const sourceInFilteredNodes = filteredNodes.find(node => node.id === edge.source);
    //     const targetInFilteredNodes = filteredNodes.find(node => node.id === edge.target);

    //     if (sourceInFilteredNodes && targetInFilteredNodes) {
    //         filteredEdges.push(edge);
    //     } else {
    //         const intersection = getIntersection(
    //             sourceNode.x, sourceNode.y,
    //             targetNode.x, targetNode.y,
    //             clientWidth, clientHeight,
    //             offsetX - TOTAL_WIDTH / 2, offsetY - TOTAL_HEIGHT / 2
    //         );

    //         if (intersection) {
    //             console.log("there is an intersection")
    //             const intersectionId = `intersection_${edge.source}_${edge.target}`;

    //             if (!intersectionNodes[intersectionId]) {
    //                 intersectionNodes[intersectionId] = {
    //                     id: intersectionId,
    //                     x: intersection.x,
    //                     y: intersection.y,
    //                     color: "#000000", // Intersection point color
    //                     type: "intersection"
    //                 };
    //             }

    //             if (sourceInFilteredNodes) {
    //                 filteredEdges.push({
    //                     source: edge.source,
    //                     target: intersectionId,
    //                     type: edge.type
    //                 });
    //             }

    //             if (targetInFilteredNodes) {
    //                 filteredEdges.push({
    //                     source: intersectionId,
    //                     target: edge.target,
    //                     type: edge.type
    //                 });
    //             }
    //         }
    //     }
    // });

    // // Add intersection nodes to filtered nodes
    // Object.values(intersectionNodes).forEach(node => filteredNodes.push(node));

    // console.log('Filtered edges:', filteredEdges);
    // console.log('Filtered nodes with intersections:', filteredNodes);

    // Filter edges based on the filtered nodes
    const filteredEdges = graphData.edges.filter(edge => {
        const sourceInFilteredNodes = filteredNodes.find(node => node.id === edge.source);
        const targetInFilteredNodes = filteredNodes.find(node => node.id === edge.target);

        console.log(`Edge from ${edge.source} to ${edge.target} - source in filtered nodes: ${!!sourceInFilteredNodes}, target in filtered nodes: ${!!targetInFilteredNodes}`);

        return sourceInFilteredNodes && targetInFilteredNodes;
    });

    console.log('Filtered edges:', filteredEdges);

    if (!svg) {
        initializeGraph();
    }

    // updateGraph(graphData);
    updateGraph({nodes: filteredNodes, edges: filteredEdges});
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
    node.each(function(d) {
        console.log(`Node ${d.id} position during tick: (${d.x}, ${d.y})`);
    });
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