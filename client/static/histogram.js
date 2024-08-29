export function createHistogram(containerId, barColor, xAxisLabel) {
    // Initial setup for the histogram
    const margin = {top: 20, right: 30, bottom: 250, left: 40}, 
          width = window.innerWidth - margin.left - margin.right,
          height = window.innerHeight - margin.top - margin.bottom;

    const svg = d3.select(`#${containerId}`)
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Y scale for frequency
    const y = d3.scaleLinear()
        .range([height, 0]);

    const yAxis = svg.append("g")
        .attr("class", "y axis");

    // X-axis label
    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", width / 2)
        .attr("y", height + 100)
        .style("text-anchor", "middle")
        .text(xAxisLabel);

    // Initialize an empty buffer for transaction sizes
    let dataBuffer = [];

    function updateHistogram(dataValue) {
        // Ensure dataValue is valid
        if (isNaN(dataValue) || dataValue === null || dataValue === undefined) {
            console.warn('Invalid data value:', dataValue);
            return;
        }

        // Add new data to the buffer
        dataBuffer.push(dataValue);
        if (dataBuffer.length > 1000) dataBuffer.shift(); // Limit the buffer size

        // Automatically adjust the x-axis domain based on the data
        let xMin = d3.min(dataBuffer);
        let xMax = d3.max(dataBuffer);

        // Ensure the domain is valid
        if (xMin === xMax) {
            console.warn('xMin equals xMax, adjusting xMax.');
            xMax = xMin + 1; // Adjust slightly to prevent the range from collapsing
        }

        const x = d3.scaleLinear()
            .domain([xMin, xMax])
            .range([0, width]);

        const xAxis = svg.select(".x.axis");
        if (xAxis.empty()) {
            svg.append("g")
                .attr("class", "x axis")
                .attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x))
                .selectAll("text")
                .style("font-size", "14px") // Adjust the size as needed
                .style("fill", "white");
        } else {
            xAxis.transition().call(d3.axisBottom(x))
                .selectAll("text")
                .style("font-size", "14px") // Adjust the size as needed
                .style("fill", "white");
        }

        // Generate bins for the histogram based on the updated x-axis
        const histogram = d3.histogram()
            .value(d => d)
            .domain(x.domain())
            .thresholds(x.ticks(40)); // Number of bins

        // Compute the bins
        const bins = histogram(dataBuffer);

        // Update Y scale
        const yMax = d3.max(bins, d => d.length);
        y.domain([0, yMax]);
        yAxis.transition().call(d3.axisLeft(y))
            .selectAll("text")
            .style("font-size", "14px") // Adjust the size as needed
            .style("fill", "white");

        // Join the data to bars
        const bars = svg.selectAll(".bar")
            .data(bins);

        // Enter new bars
        bars.enter().append("rect")
            .attr("class", "bar")
            .attr("x", d => x(d.x0) + 1)
            .attr("y", d => y(d.length))
            .attr("width", d => {
                const x0 = x(d.x0);
                const x1 = x(d.x1);
                let calculatedWidth = x1 - x0 - 1;
                if (calculatedWidth < 0) {
                    [d.x0, d.x1] = [d.x1, d.x0];
                    calculatedWidth = x(d.x1) - x(d.x0) - 1;
                }
                return calculatedWidth;
            })
            .attr("height", d => height - y(d.length))
            .style("fill", barColor)
            .merge(bars) // Update existing bars
            .transition()
            .duration(250)
            .attr("x", d => x(d.x0) + 1)
            .attr("y", d => y(d.length))
            .attr("width", d => {
                const x0 = x(d.x0);
                const x1 = x(d.x1);
                const width = x1 - x0 - 1;
                return isNaN(width) ? 0 : width;
            })
            .attr("height", d => height - y(d.length));

        // Remove old bars
        bars.exit().remove();
    }

    return updateHistogram;
}