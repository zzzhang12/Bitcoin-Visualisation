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
    
    socket.on('reload', function() {
        console.log("Reloading page because the server state has been reset");
        location.reload();  // This reloads the iframe or page
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
    const scaleFactorX = 4;
    const scaleFactorY = 4;

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
    const nodesToUpdate = newGraphData.nodes.filter(node => existingNodes.has(node.id));

    console.log("number of nodesToAdd: ", nodesToAdd.length)
    
    // Update positions of existing nodes
    nodesToUpdate.forEach(updatedNode => {
        const nodeToUpdate = node.data().find(d => d.id === updatedNode.id);
        if (nodeToUpdate) {
            nodeToUpdate.x = updatedNode.x;
            nodeToUpdate.y = updatedNode.y;
        }
    });

    // Combine the existing nodes with the new nodes
    const updatedNodes = node.data().concat(nodesToAdd);

    // Update node data binding with new nodes
    node = node.data(updatedNodes, d => d.id);

    // Remove exiting nodes
    node.exit().remove();

    node.raise();

    // const updatedNodes = node.data().concat(nodes);
    // node = node.data(updatedNodes, d => d.id);

    // const nodeById = new Map(node.data().map(d => [d.id, d]));

    const nodeEnter = node.enter().append("circle")
        .attr("class", "node")
        .attr("r", d => d.type === 'tx' ? 3 : 1)
        .attr("cx", d => d.x - offsetX)
        .attr("cy", d => d.y - offsetY)
        .style("fill", d => {
            if (d.type === 'input') {
                return mapZScoreToColor(d.z_score_balance, d.color);
            } else if (d.type === 'output') {
                return mapZScoreToColor(d.z_score_balance, d.color);
            } else {
                return d.color;
            }
        })
        .call(d3.drag()
            .on("start", dragStarted)
            .on("drag", dragged)
            .on("end", dragEnded))
        .on("click", function(event, d) {
            document.getElementById('infoBox').innerText = `Node ID: ${d.id}`;
        })
        .on("mouseover", function(event, d) {
            if (d.type !== 'tx' && d.balance !== null && d.balance !== undefined) {
                displayValue('balance', d.balance, event.pageX, event.pageY, d.id);
            }
        });

    node = nodeEnter.merge(node);

    // Update link data binding
    const nodeById = new Map(updatedNodes.map(d => [d.id, d]));
    newGraphData.edges.forEach(d => {
        d.source = nodeById.get(d.source) || d.source;
        d.target = nodeById.get(d.target) || d.target;
    });

    // Combine the existing links with the new links
    link = link.data(newGraphData.edges, d => `${d.source.id}-${d.target.id}`);

    link.exit().remove();

    const linkEnter = link.enter().append("line")
        .attr("class", "link")
        .style("stroke", d => d.color)
        // .style("stroke-width", 0.5)
        .style("stroke-width", d => {
            if (d.type === 'addr_link'){
                return 0.3
            }
            else{
                const zScore = d.source.z_score_tx || d.target.z_score_tx || 0.5; 
                const strokeWidth = mapZScoreToThickness(zScore);
                // console.log(`Edge stroke width: ${strokeWidth}`);
                return strokeWidth;
                // return mapZScoreToThickness(zScore);
            }
        })
        .on("mouseover", function(event, d) {
            let value;
            if (d.type != 'addr_link'){
                if (d.type === 'in_link') {
                    // value = nodeById.get(d.source.id).size;
                    value = d.source.size;
                } else if (d.type === 'out_link') {
                    // value = nodeById.get(d.target.id).size;
                    value = d.target.size;
                }
                value = (value / 100000000).toPrecision(4);
                displayValue('transaction', value, event.pageX, event.pageY, `${d.source.id}-${d.target.id}`); 
            }
        });

    link = linkEnter.merge(link);


    // // Update node data with new nodes
    // node = node.data(node.data().concat(nodesToAdd), d => d.id);
    // node.exit().remove();

    // node = node.enter().append("circle")
    //     .attr("class", "node")
    //     .attr("r", d => d.type === 'tx' ? 3 : 0.5)
    //     // .attr("r", d => 6)  // for testing intersection nodes
    //     .attr("cx", d => d.x - offsetX)
    //     .attr("cy", d => d.y - offsetY)
    //     .style("fill", d => d.color)
    //     .call(d3.drag()
    //         .on("start", dragStarted)
    //         .on("drag", dragged)
    //         .on("end", dragEnded))
    //     // .on("click", focusOnNode)
    //     .on("click", function(event, d) {
    //         document.getElementById('infoBox').innerText = `Node ID: ${d.id}`;
    //     })
    //     .merge(node);

    // // Update link data with new links
    // const nodeById = new Map(node.data().map(d => [d.id, d]));
    // link = link.data(link.data().concat(linksToAdd), d => `${d.source}-${d.target}`);
    // link.exit().remove();

    // link = link.enter().append("line")
    //     .attr("class", "link")
    //     .style("stroke", d => d.type === 'in_link' ? "#FF9933" : "#003399")
    //     .style("stroke-width", 0.5) 
    //     .on("mouseover", function(event, d) {
    //         let value;
    //         if (d.type === 'in_link') {
    //             value = nodeById.get(d.source.id).size;
    //         } else if (d.type === 'out_link') {
    //             value = nodeById.get(d.target.id).size;
    //         }
    //         value = (value / 100000000).toPrecision(4)
    //         displayValue(value, event.pageX, event.pageY);
    //     })
    //     .merge(link);

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


// Function to map z-score to edge thickness
function mapZScoreToThickness(zScore) {
    const minThickness = 0.4;
    const maxThickness = 3.0; 

    const logScale = d3.scaleLog()
        .domain([0.1, 10]) 
        .range([minThickness, maxThickness])
        .clamp(true);

    const adjustedZScore = Math.abs(zScore) + 0.1;

    return logScale(adjustedZScore);
}


function mapZScoreToColor(zScore, baseColor) {
    // Define a scale for color saturation/vibrancy
    const scale = d3.scaleLinear()
        .domain([-3, 0, 3])
        .range([0.3, 1, 1.7]) // Adjust these values for desired effect
        .clamp(true);

    const intensity = scale(zScore);

    // Convert hex color to HSL
    const baseHSL = d3.hsl(baseColor);

    // Adjust lightness based on z-score
    baseHSL.l = baseHSL.l * intensity;

    return baseHSL.toString();
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
        return d.x - offsetX;
    })
    .attr("cy", d => {
        if (d.y === undefined) {
            console.error("Undefined y for node", d);
            return 0;
        }
        return d.y - offsetY;
    });
    link
        .attr("x1", d => {
            if (!d.source || d.source.x === undefined) {
                console.error("Undefined source or source.x for link", d);
                return 0;
            }
            return d.source.x - offsetX;
        })
        .attr("y1", d => {
            if (!d.source || d.source.y === undefined) {
                console.error("Undefined source or source.y for link", d);
                return 0;
            }
            return d.source.y - offsetY;
        })
        .attr("x2", d => {
            if (!d.target || d.target.x === undefined) {
                console.error("Undefined target or target.x for link", d);
                return 0;
            }
            return d.target.x - offsetX;
        })
        .attr("y2", d => {
            if (!d.target || d.target.y === undefined) {
                console.error("Undefined target or target.y for link", d);
                return 0;
            }
            return d.target.y - offsetY;
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