let socket;

const ITEMS_PER_PAGE = 10; // Number of snapshots per page
let currentPage = 1;

window.addEventListener("load", init, false);

function init() {
    console.log("Initializing...");
    runWebSocket();
}

function runWebSocket() {
    socket = io(`http://${SOCKET_IP}:3000/`,{
        withCredentials: true,
    })

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
    document.getElementById('pagination').style.display = 'flex'; // Show the pagination controls
});

document.getElementById('resetGraph').addEventListener('click', () => {
    socket.emit('controller_command', { action: 'resetGraph' });
    console.log('Sent reset graph command');
});

// Function to toggle visibility of the input fields
document.getElementById('filterTxVal').addEventListener('click', () => {
    const txValSection = document.getElementById('txValInputSection');
    txValSection.style.display = txValSection.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('filterBalance').addEventListener('click', () => {
    const balanceSection = document.getElementById('balanceInputSection');
    balanceSection.style.display = balanceSection.style.display === 'none' ? 'block' : 'none';
});

// Send filter command for Transaction Value
document.getElementById('applyTxValFilter').addEventListener('click', () => {
    const percentileVal = document.getElementById('percentileValFilter').value;
    if (percentileVal) {
        socket.emit('controller_command', { 
            action: 'filterNodes', 
            filterType: 'transactionValue', 
            percentile: percentileVal 
        });
        // Change the filter button to green to indicate success
        const filterTxVal = document.getElementById('filterTxVal');
        filterTxVal.style.backgroundColor = '#28a745' ; // Change background color to green
        filterTxVal.style.color = '#fff' ; // Change text color to white

        // Display the cancel filter button
        document.getElementById('cancelTxValFilter').style.display = 'inline-block'; 

        // Show View Transaction Info section for Transaction Value filter
        document.getElementById('viewTxValInfoSection').style.display = 'block';

        // Display success message
        let messageElement = document.getElementById('txValMessage');
        if (!messageElement) {
            messageElement = document.createElement('p');
            messageElement.id = 'txValMessage';
            messageElement.textContent = "Filter applied. To update the filter, input a new percentile and click 'Apply' again.";
            document.getElementById('txValInputSection').appendChild(messageElement);
            // Style
            messageElement.style.textAlign = 'center';
            document.getElementById('txValInputSection').insertBefore(messageElement, txValInputSection.firstChild);
        }

        console.log('Sent filter transaction value command with percentile:', percentileVal);

    }
});


// Send cancel filter command for Transaction Value
document.getElementById('cancelTxValFilter').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'cancelFilter',
        filterType: 'transactionValue'
    });

    // Reset the buttons and input fields
    document.getElementById('filterTxVal').style.backgroundColor = '';
    document.getElementById('filterTxVal').style.color = '#000000';
    document.getElementById('cancelTxValFilter').style.display = 'none';
    document.getElementById('viewTxValInfoSection').style.display = 'none';
    document.getElementById('previousTxValNode').style.display = 'none';
    document.getElementById('nextTxValNode').style.display = 'none';

    // Reset the "View" button color to default
    const viewTxValInfoButton = document.getElementById('viewTransactionInfoTxVal');
    viewTxValInfoButton.style.backgroundColor = ''; // Original background
    viewTxValInfoButton.style.color = ''; // Original text color

    // Remove the success message
    const messageElement = document.getElementById('txValMessage');
    if (messageElement) {
        messageElement.remove();
    }
    console.log('Cancelled transaction value filter');
});


// Send filter command for Address Balance
document.getElementById('applyBalanceFilter').addEventListener('click', () => {
    const percentileBalance = document.getElementById('percentileBalanceFilter').value;
    if (percentileBalance) {
        socket.emit('controller_command', { 
            action: 'filterNodes', 
            filterType: 'addressBalance', 
            percentile: percentileBalance
        });
        document.getElementById('filterBalance').style.backgroundColor = '#28a745' ;

        // Change the filter button to green to indicate success
        const filterBalance = document.getElementById('filterBalance');
        filterBalance.style.backgroundColor = '#28a745' ; // Change background color to green
        filterBalance.style.color = '#fff' ; // Change text color to white

        // Display the cancel filter button
        document.getElementById('cancelBalanceFilter').style.display = 'inline-block'; 

        // Show View Address Info section for Address Balance filter
        document.getElementById('viewBalanceInfoSection').style.display = 'block';

        // Display success message
        let messageElement = document.getElementById('balanceMessage');
        if (!messageElement) {
            messageElement = document.createElement('p');
            messageElement.id = 'balanceMessage';
            messageElement.textContent = "Filter applied. To update the filter, input a new percentile and click 'Apply' again.";
            document.getElementById('balanceInputSection').appendChild(messageElement);

            // Style
            messageElement.style.textAlign = 'center'; 
            document.getElementById('balanceInputSection').insertBefore(messageElement, balanceInputSection.firstChild);
        }
        
        console.log('Sent filter address balance command with percentile:', percentileBalance);

    }
});


// Send cancel filter command for Address Balance
document.getElementById('cancelBalanceFilter').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'cancelFilter',
        filterType: 'addressBalance'
    });

    // Reset the buttons and input fields
    document.getElementById('filterBalance').style.backgroundColor = '';
    document.getElementById('filterBalance').style.color = '#000000';
    document.getElementById('cancelBalanceFilter').style.display = 'none';
    document.getElementById('viewBalanceInfoSection').style.display = 'none';
    document.getElementById('previousBalanceNode').style.display = 'none';
    document.getElementById('nextBalanceNode').style.display = 'none';

    // Reset the "View" button color to default
    const viewBalanceInfoButton = document.getElementById('viewTransactionInfoBalance');
    viewBalanceInfoButton.style.backgroundColor = ''; // Original background
    viewBalanceInfoButton.style.color = ''; // Original text color

    // Remove the success message
    const messageElement = document.getElementById('balanceMessage');
    if (messageElement) {
        messageElement.remove();
    }

    console.log('Cancelled address balance filter');
});


// View Transaction Info for Transaction Value
document.getElementById('viewTransactionInfoTxVal').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'viewTransactionInfo',
        filterType: 'transactionValue'
    });

    // Change the "View" button to green to indicate it's active
    const viewTxValInfoButton = document.getElementById('viewTransactionInfoTxVal');
    viewTxValInfoButton.style.backgroundColor = '#28a745'; // Green background
    viewTxValInfoButton.style.color = '#fff'; // White text

    // Show Previous and Next buttons
    document.getElementById('previousTxValNode').style.display = 'block';
    document.getElementById('nextTxValNode').style.display = 'block';
    
    console.log('Viewing transaction info for transaction value filter');
});


// View Address Info for Balance Filter
document.getElementById('viewTransactionInfoBalance').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'viewTransactionInfo',
        filterType: 'addressBalance'
    });

    // Change the "View" button to green to indicate it's active
    const viewBalanceInfoButton = document.getElementById('viewTransactionInfoBalance');
    viewBalanceInfoButton.style.backgroundColor = '#28a745'; // Green background
    viewBalanceInfoButton.style.color = '#fff'; // White text

    // Show Previous and Next buttons
    document.getElementById('previousBalanceNode').style.display = 'block';
    document.getElementById('nextBalanceNode').style.display = 'block';

    console.log('Viewing address info for balance filter');
});

// Attach event listeners for the TxVal filter navigation buttons
document.getElementById('previousTxValNode').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'navigateTxValNode',
        direction: 'previous'
    });
    console.log('Sent navigate previous transaction node command');
});

document.getElementById('nextTxValNode').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'navigateTxValNode',
        direction: 'next'
    });
    console.log('Sent navigate next transaction node command');
});

// Attach event listeners for the Balance filter navigation buttons
document.getElementById('previousBalanceNode').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'navigateBalanceNode',
        direction: 'previous'
    });
    console.log('Sent navigate previous balance node command');
});

document.getElementById('nextBalanceNode').addEventListener('click', () => {
    socket.emit('controller_command', {
        action: 'navigateBalanceNode',
        direction: 'next'
    });
    console.log('Sent navigate next balance node command');
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
    const regionMapping = {}; // To track which snapshot is loaded into which region


    // Sort snapshots by timestamp
    snapshots.sort((a, b) => {
        const dateA = extractDateFromFilename(a.file_name);
        const dateB = extractDateFromFilename(b.file_name);
        console.log(`Comparing: ${dateA} and ${dateB}`);
        return dateB.getTime() - dateA.getTime();  // most recent first)
    });

    // console.log("Sorted snapshots:", snapshots);
    
    const totalPages = Math.ceil(snapshots.length / ITEMS_PER_PAGE);

    function renderPage(page){
        snapshotList.innerHTML = '';
        const start = (page - 1) * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const pageSnapshots = snapshots.slice(start, end);

        pageSnapshots.forEach(snapshot => {
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

            const regions = ['Region 1', 'Region 2', 'Region 3', 'Region 4', 'Region 5', 'Region 6'];

            regions.forEach((region, index) => {
                const regionButton = document.createElement('button');
                regionButton.textContent = region;
                regionButton.className = 'region-button';

                // Check if this region already has a snapshot loaded
                if (regionMapping[region] && regionMapping[region] === snapshotName) {
                    regionButton.style.backgroundColor = '#28a745'; // Green to indicate it’s loaded
                } else {
                    regionButton.style.backgroundColor = '#444'; // Default color
                }

                regionButton.addEventListener('mouseenter', () => {
                    regionButton.style.backgroundColor = '#666';
                });
                regionButton.addEventListener('mouseleave', () => {
                    if (regionMapping[region] === snapshotName) {
                        regionButton.style.backgroundColor = '#28a745'; // Keep green if already loaded
                    } else {
                        regionButton.style.backgroundColor = '#444';
                    }
                });

                regionButton.addEventListener('click', () => {
                    const WIDTH = 1920;
                    const HEIGHT = 1080;

                    // console.log(x, y)

                    // let x, Y
                    // if (index == 0){
                    //     x = 
                    // }
                    const payloads = [
                        // Static graph snapshot -- 2 x 2 screens
                        {
                            app: {
                                states: {
                                    load: {
                                        url: `http://${SOCKET_IP}:3000/static_graph?snapshot=${snapshot.file_name}`
                                    }
                                },
                                url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                            },
                            x: (index * 2 + 4) * WIDTH,  
                            y: 0,
                            w: 2 * WIDTH,       
                            h: 2 * HEIGHT,  
                            space: "DOCluster"  
                        },
                        // Info panel 
                        {
                            app: {
                                states: {
                                    load: {
                                        url: `http://${SOCKET_IP}:3000/snapshot_stats?snapshot=${snapshot.file_name}`
                                    }
                                },
                                url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                            },
                            x: (index * 2 + 4) * 1920,  
                            y: 2 * HEIGHT,
                            w: WIDTH,       
                            h: HEIGHT,  
                            space: "DOCluster"  
                        },
                        // Line graphs of tx rate and tx fee
                        {
                            app: {
                                states: {
                                    load: {
                                        url: `http://${SOCKET_IP}:3000/static_lineGraph?snapshot=${snapshot.file_name}&lineGraphTypes=tx_fee,tx_rate`
                                    }
                                },
                                url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                            },
                            x: (index * 2 + 5) * 1920, 
                            y: 2 * HEIGHT,
                            w: WIDTH,       
                            h: HEIGHT,  
                            space: "DOCluster"  
                        },
                        // Histogram of tx value
                        {
                            app: {
                                states: {
                                    load: {
                                        url: `http://${SOCKET_IP}:3000/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_value`
                                    }
                                },
                                url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                            },
                            x: (index * 2 + 4) * 1920,  
                            y: 3 * HEIGHT,
                            w: WIDTH,       
                            h: HEIGHT,  
                            space: "DOCluster"  
                        },
                        // Histogram of tx size
                        {
                            app: {
                                states: {
                                    load: {
                                        url: `http://${SOCKET_IP}:3000/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_size`
                                    }
                                },
                                url: "http://gdo-apps.dsi.ic.ac.uk:9080/app/html"
                            },
                            x: (index * 2 + 5) * 1920, 
                            y: 3 * HEIGHT,
                            w: WIDTH,       
                            h: HEIGHT,  
                            space: "DOCluster"  
                        }
                    ];

                    // // Execute multiple fetch requests in parallel
                    // Promise.all(
                    //     payloads.map(payload => 
                    //         fetch("http://gdo-apps.dsi.ic.ac.uk:9080/section", {
                    //             method: "POST",
                    //             headers: {
                    //                 'Content-Type': 'application/json'
                    //             },
                    //             body: JSON.stringify(payload)
                    //         })
                    //         .then(response => {
                    //             if (!response.ok) {
                    //                 throw new Error('Failed to load snapshot.');
                    //             }
                    //             return response.json();
                    //         })
                    //     )
                    // )
                    // .then(dataArray => {
                    //     dataArray.forEach(data => {
                    //         console.log('Snapshot loaded into the observatory:', data);
                    //     });
                    //     button.style.backgroundColor = '#28a745'; // Green color to indicate success
                    //     regionButtons.remove();
                    //     activeRegionButtons = null; // Reset the active region buttons
                    // })
                    // .catch(error => {
                    //     console.error('Error loading snapshot into the observatory:', error);
                    // });
                    // fetch("http://gdo-apps.dsi.ic.ac.uk:9080/section", {
                    //     method: "POST",
                    //     headers: {
                    //         'Content-Type': 'application/json'
                    //     },
                    //     body: JSON.stringify(payload)
                    // })
                    

                    // //  For local testing only
                    // window.open(`/static_graph?snapshot=${snapshot.file_name}`, '_blank')
                    // window.open(`/snapshot_stats?snapshot=${snapshot.file_name}`, '_blank')
                    // window.open(`/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_value`, '_blank');
                    window.open(`/static_histogram?snapshot=${snapshot.file_name}&histogramType=tx_size`, '_blank');
                    // window.open(`/static_lineGraph?snapshot=${snapshot.file_name}&lineGraphTypes=tx_fee,tx_rate`, '_blank');

                    // If this region was previously occupied by another snapshot, reset its color
                    if (regionMapping[region] && regionMapping[region] !== snapshotName) {
                        const previousSnapshotButton = Array.from(document.querySelectorAll('.snapshot-button'))
                            .find(btn => btn.textContent === regionMapping[region]);
                        if (previousSnapshotButton) {
                            previousSnapshotButton.style.backgroundColor = '#444';
                        }
                    }

                    // Update the region mapping to the new snapshot
                    regionMapping[region] = snapshotName;
                    button.style.backgroundColor = '#28a745'; // Green color to indicate success

                    // // Remove region buttons after selecting one
                    // regionButtons.remove();
                    // activeRegionButtons = null;
                });

                regionButtons.appendChild(regionButton);
            });
            button.after(regionButtons);
            activeRegionButtons = regionButtons;
        });
        });
        // Update navigation buttons
        document.getElementById('prevButton').disabled = currentPage === 1;
        document.getElementById('nextButton').disabled = currentPage === totalPages;
    }

     // Handle the "Next" button
     document.getElementById('nextButton').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            renderPage(currentPage);
        }
    });

    // Handle the "Previous" button
    document.getElementById('prevButton').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage(currentPage);
        }
    });

    // Initial render of the first page
    renderPage(currentPage);
    snapshotList.style.display = 'block'; // Show the list
}

// Helper function to extract Date object from filename
function extractDateFromFilename(filename) {
    const timestamp = filename.replace('graph_snapshot_', '').replace('.json', '');
    const [datePart, timePart] = timestamp.split('_');
    
    const [year, month, day] = datePart.split('-');
    const [hours, minutes, seconds] = timePart.split('-');
    
    const dateObj = new Date(year, month - 1, day, hours, minutes, seconds);
    
    return dateObj;
}