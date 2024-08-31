let socket;

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
    socket = io("http://localhost:3000", {
        withCredentials: true,
    }); 

    socket.on('connect', function() {
        console.log("Connected to server WebSocket");
    });

    socket.on('disconnect', function() {
        console.log('Disconnected from server');
    });

    socket.on('connection_response', function(msg) {
        console.log('Server response:', msg);
    });
}

// Attach event listeners to buttons
document.getElementById('startVisualization').addEventListener('click', () => {
    socket.emit('controller_command', { action: 'startVisualization' });
    console.log('Sent start visualization command');
});

document.getElementById('saveSnapshot').addEventListener('click', () => {
    socket.emit('controller_command', { action: 'saveSnapshot' });
    console.log('Sent save snapshot command');
});

document.getElementById('showSnapshot').addEventListener('click', () => {
    fetchSnapshots();
});

document.getElementById('resetGraph').addEventListener('click', () => {
    socket.emit('controller_command', { action: 'resetGraph' });
    console.log('Sent reset graph command');
});


function fetchSnapshots() {
    fetch('/list_snapshots')
        .then(response => response.json())
        .then(snapshots => {
            displaySnapshotList(snapshots);
        })
        .catch(error => console.error('Error fetching snapshots:', error));
}


function displaySnapshotList(snapshots) {
    const snapshotList = document.getElementById('snapshotList');
    snapshotList.innerHTML = ''; // Clear previous list

    let activeRegionButtons = null; 

    snapshots.forEach(snapshot => {
        const fileName = snapshot.file_name
        const snapshotName = fileName.replace('graph_snapshot_', '').replace('.json', '');
        const button = document.createElement('button');
        button.className = 'snapshot-button';
        button.textContent = snapshotName;

    const infoBox = document.createElement('div');
    infoBox.className = 'snapshot-info';

    // Structure the stats into columns
    infoBox.innerHTML = `
        <div id="infoBoxStatsArea" style="display: flex; flex-wrap: wrap; gap: 10px;">
            <div class="stat-block">
                <i>TxRate:</i> ${snapshot.stats.txRate ? snapshot.stats.txRate + ' tps' : 'N/A'}<br>
                <i>NumTx:</i> ${snapshot.stats.numTx || 'N/A'}<br>
                <i>NumNodes:</i> ${snapshot.stats.numNodes || 'N/A'}
            </div>
            <div class="stat-block">
                <b>Value</b><br>
                <i>Max:</i> ${snapshot.stats.txMaxVal || 'N/A'}<br>
                <i>Total:</i> ${snapshot.stats.txTotalVal || 'N/A'}<br>
                <i>Avg:</i> ${snapshot.stats.txAvgVal || 'N/A'}
            </div>
            <div class="stat-block">
                <b>Fees</b><br>
                <i>Max:</i> ${snapshot.stats.txMaxFee || 'N/A'}<br>
                <i>Total:</i> ${snapshot.stats.txTotalFee || 'N/A'}<br>
                <i>Avg:</i> ${snapshot.stats.txAvgFee || 'N/A'}
            </div>
            <div class="stat-block">
                <b>Size</b><br>
                <i>Max:</i> ${snapshot.stats.txMaxSize || 'N/A'}<br>
                <i>Total:</i> ${snapshot.stats.txTotalSize || 'N/A'}<br>
                <i>Avg:</i> ${snapshot.stats.txAvgSize || 'N/A'}
            </div>
            <div class="stat-block">
                <b>Wallet Balance</b><br>
                <i>Max:</i> ${snapshot.stats.balanceMax || 'N/A'}<br>
                <i>Median:</i> ${snapshot.stats.balanceMed || 'N/A'}<br>
                <i>IQR:</i> ${snapshot.stats.balanceIQR || 'N/A'}
            </div>
        </div>
    `;

    snapshotList.appendChild(button);
    document.body.appendChild(infoBox);

    // Event listeners for hover to show and hide the info box
    button.addEventListener('mouseenter', (event) => {
        const rect = button.getBoundingClientRect();
        infoBox.style.top = `${rect.top}px`;
        infoBox.style.left = `${rect.right + 10}px`;
        infoBox.style.display = 'block';
    });

    button.addEventListener('mouseleave', () => {
        infoBox.style.display = 'none';
    });

    // Handle click event to show region buttons
    button.addEventListener('click', () => {
        // If there's already a set of region buttons active, remove it
        if (activeRegionButtons) {
            activeRegionButtons.remove();
        }

        // Check if the clicked button already has its region buttons displayed
        if (button.nextSibling && button.nextSibling.className === 'region-buttons') {
            activeRegionButtons = null; // If so, remove them
            return;
        }

        const regionButtons = document.createElement('div');
        regionButtons.className = 'region-buttons'

        const regions = ['Region 1', 'Region 2', 'Region 3', 'Region 4', 'Region 5'];

        regions.forEach((region, index) => {
            const regionButton = document.createElement('button');
            regionButton.textContent = region;
            regionButton.className = 'region-button';

            regionButton.addEventListener('mouseenter', () => {
                regionButton.style.backgroundColor = '#666';
            });
            regionButton.addEventListener('mouseleave', () => {
                regionButton.style.backgroundColor = '#444';
            });

            regionButton.addEventListener('click', () => {
                const x = (index * 2 + 2) * 1920;
                const y = 0;

                console.log(x, y)
                const payload = {
                    app: {
                        states: {
                            load: {
                                url: `http://gdo-apps.dsi.ic.ac.uk:9080/static_graph?snapshot=${snapshot.file_name}`
                            }
                        },
                        url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                    },
                    x: x,    
                    y: y,    
                    w: 5760,       
                    h: 4320,  
                    space: "DOCluster"  
                };

                // fetch("http://gdo-apps.dsi.ic.ac.uk:9080/section", {
                //     method: "POST",
                //     headers: {
                //         'Content-Type': 'application/json'
                //     },
                //     body: JSON.stringify(payload)
                // })
                
                // .then(response => {
                //     if (!response.ok) {
                //         throw new Error('Failed to load snapshot.');
                //     }
                //     return response.json();
                // })
                // .then(data => {
                //     console.log('Snapshot loaded into the observatory:', data);
                //     button.style.backgroundColor = '#28a745'; // Green color to indicate success
                //     regionButtons.remove();
                //     activeRegionButtons = null; // Reset the active region buttons
                // })
                // .catch(error => {
                //     console.error('Error loading snapshot into the observatory:', error);
                // });

                // For local testing only
                // window.open(`/static_graph?snapshot=${snapshot.file_name}`, '_blank')
                // window.open(`/snapshot_stats?snapshot=${snapshot.file_name}`, '_blank')
                // window.open(`/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_value`, '_blank');
                // window.open(`/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_size`, '_blank');
                window.open(`/static_lineGraph?snapshot=${snapshot.file_name}&lineGraphTypes=tx_fee,tx_rate`, '_blank');

                button.style.backgroundColor = '#28a745'; // Green color to indicate success
                regionButtons.remove();
                activeRegionButtons = null; // Reset the active region buttons
            });

            regionButtons.appendChild(regionButton);
        });
        button.after(regionButtons);
        activeRegionButtons = regionButtons;
    });
    });
    snapshotList.style.display = 'block'; // Show the list
}