let dataBuffer = []; 

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
    // let dataBuffer = [];
    // histogramDataBuffers[containerId] = [];
    let x;

    function updateHistogram(dataValue) {
        // let dataBuffer = histogramDataBuffers[containerId];

        // Ensure dataValue is valid
        if (isNaN(dataValue) || dataValue === null || dataValue === undefined) {
            console.warn('Invalid data value:', dataValue);
            return;
        }

        // Add new data to the buffer
        dataBuffer.push(dataValue);
        if (dataBuffer.length > 1000) dataBuffer.shift(); // Limit the buffer size

        if (dataBuffer.length < 2) {
            console.warn('Not enough data to generate histogram');
            return; // Early exit if not enough data
        }

        // Automatically adjust the x-axis domain based on the data
        let xMin = d3.min(dataBuffer);
        let xMax = d3.max(dataBuffer);
        console.log("xMin: ", xMin)
        console.log("xMax: ", xMax)

        // Ensure the domain is valid
        if (xMin === xMax) {
            console.warn('xMin equals xMax, adjusting xMax.');
            xMax = xMin + 1; // Adjust slightly to prevent the range from collapsing
        }

         // Logarithmic scale for the x-axis
         x = d3.scaleLog()
         .domain([Math.max(xMin, 0.001), xMax])
         .range([0, width]);

        const xAxis = svg.select(".x.axis");
        if (xAxis.empty()) {
            svg.append("g")
                .attr("class", "x axis")
                .attr("transform", `translate(0,${height})`)
                .call(d3.axisBottom(x).ticks(10, ",.1s"))
                .selectAll("text")
                .style("font-size", "14px")
                .style("fill", "white");
        } else {
            xAxis.transition().call(d3.axisBottom(x))
                .selectAll("text")
                .style("font-size", "14px")
                .style("fill", "white");
        }

        // Generate bins for the histogram based on the updated x-axis
        const histogram = d3.histogram()
            .value(d => d)
            .domain(x.domain())
            .thresholds(x.ticks(50)); // Number of bins

        // Compute the bins
        const bins = histogram(dataBuffer);

        // Check and log bin issues
        bins.forEach((bin, index) => {
            let width = x(bin.x1) - x(bin.x0) - 1;
            if (width <= 0) {
                console.warn(`Bin ${index} has an invalid width: ${width}. Adjusting width to 1.`);
                width = 1;
            }
        });
        // Update Y scale
        const yMax = d3.max(bins, d => d.length);
        y.domain([0, yMax]);
        yAxis.transition().call(d3.axisLeft(y))
            .selectAll("text")
            .style("font-size", "14px")
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
                    if (calculatedWidth <= 0) {
                        console.warn(`Negative or zero width detected: ${calculatedWidth}. Adjusting to minimum width of 1.`);
                        calculatedWidth = 1; // Set a minimum width
                    }
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
                // return isNaN(width) ? 0 : width;
                return width <= 0 ? 1 : width;
            })
            .attr("height", d => height - y(d.length));

        // Remove old bars
        bars.exit().remove();
    }


    function resetHistogram() {
        dataBuffer = [];
        svg.selectAll(".bar").remove();  // Clear the bars from the histogram
        svg.select(".x.axis").call(d3.axisBottom(x).ticks(10, ",.1s"));
        svg.select(".y.axis").call(d3.axisLeft(y));
    }

    return { updateHistogram, resetHistogram };
}


export function saveHistogramSnapshot(name) {
    console.log("--------------SAVING HISTOGRAM SNAPSHOT-------------");
    const histogramData = {
        histograms: {
            [name]: histogramDataBuffers // Save the data buffer of the histogram
        }
    };
    console.log(histogramData)

    const now = new Date();
    const timestamp = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const filename = `graph_snapshot_${timestamp}.json`;

    fetch(`/save_snapshot?filename=${filename}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(histogramData)
    })
    .then(response => response.json())
    .then(data => {
        console.log("Histogram snapshot saved:", data);
    })
    .catch(error => console.error('Error saving histogram snapshot:', error));
}
