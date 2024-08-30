// lineGraph.js

export function createLineGraph(containerId, yAxisLabel, lineColor) {
    // Initial setup for the line graph
    const margin = { top: 20, right: 30, bottom: 150, left: 100 },
          width = window.innerWidth - margin.left - margin.right,
          height = window.innerHeight - margin.top - margin.bottom;

    const svg = d3.select(`#${containerId}`)
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // X scale for time
    const x = d3.scaleTime()
        .range([0, width]);

    const xAxis = svg.append("g")
        .attr("class", "x axis")
        .attr("transform", `translate(0,${height})`);

    // Y scale for the values
    const y = d3.scaleLinear()
        .range([height, 0]);

    const yAxis = svg.append("g")
        .attr("class", "y axis");

    // Line generator function
    const line = d3.line()
        .x(d => x(d.timestamp))
        .y(d => y(d.value))
        .curve(d3.curveMonotoneX);  // Apply curve for smoother line

    const path = svg.append("path")
        .datum([])
        .attr("class", "line")
        .style("fill", "none")
        .style("stroke", lineColor)
        .style("stroke-width", 2);

    // Y-axis label
    svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -height / 2)
        .attr("y", -margin.left + 20)
        .style("text-anchor", "middle")
        .style("fill", "white")
        .text(yAxisLabel);

    // X-axis label
    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", width / 2)
        .attr("y", height + margin.bottom - 10)
        .style("text-anchor", "middle")
        .style("fill", "white")
        .text("Time");

    // Initialize an empty buffer for values
    let dataBuffer = [];

    function updateLineGraph(newValue) {
        const timestamp = new Date();

        // Add the new data to the buffer
        dataBuffer.push({ timestamp: timestamp, value: newValue });
        if (dataBuffer.length > 1000) dataBuffer.shift(); // Limit the buffer size

        // Update the scales
        x.domain(d3.extent(dataBuffer, d => d.timestamp));
        y.domain([0, d3.max(dataBuffer, d => d.value)]);

        // Update the axes
        xAxis.transition().call(d3.axisBottom(x).tickFormat(d3.timeFormat("%H:%M:%S")));
        yAxis.transition().call(d3.axisLeft(y));

        // Update the line
        path.datum(dataBuffer)
            .attr("d", line);
    }

    return updateLineGraph;
}