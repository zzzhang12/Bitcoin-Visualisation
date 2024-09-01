from flask import Flask, jsonify, send_from_directory, render_template, request
import json
import networkx as nx
from fa2_modified import ForceAtlas2
import websocket
import threading
import traceback
from flask_socketio import SocketIO, emit
import time
import random 
import requests
import numpy as np
import copy
import os
                    
app = Flask(__name__, static_folder='../client/static', template_folder='../client/templates')
socketio = SocketIO(app, cors_allowed_origins="*")

# WebSocket to receive Bitcoin transactionss
BITCOIN_WS_URL = "wss://ws.blockchain.info/inv"

# Global Variables
queue = []
MAX_SIZE = 100 # max queue size
nodes = [] # all nodes
edges = [] # all edges
node_ids = set()   # for tracking nodes
broadcast_interval = 2 # Frequency in seconds to broadcast data to clients
scale_factor = 2.0
nx_graph = nx.Graph()  # Global NetworkX graph instance
address_cache = {}  # Cache of addresses balances
current_addresses = {} # Addresses in the current visualisation, resets to empty when server resetes
balance_stats = {}
node_positions = {}
addresses_to_query = [] # Addresses not in cache, thus need API query
address_dict = {} # track addresses and associated nodes
paused = False
msgBuf = []
start_visualization = False # Initialised to false, True when visualisation started by controller
graph_data_accumulated = {
    "nodes": [],
    "edges": [],
    "stats": {},
    "histograms": {},
    "lineGraphs": {}
}
clients_received = 0


# Locks
queue_lock = threading.Lock()
forceatlas2_lock = threading.Lock()
start_lock = threading.Lock()
save_lock = threading.Lock()

# Statistics 
mean_tx = 0 # Mean of transaction values
std_dev_tx = 0 # Standard deviation of transaction values 
mean_balance = 0 # Mean of address balances
std_dev_balance = 0 # Standard deviation of address balances

# For testing - send local files
file_index = 0
# json_files = [
#     '1.json',
#     '2.json',
#     '3.json',
#     '4.json',
#     '5.json',
#     '6.json',
#     '7.json',
#     '8.json',
#     '9.json',
#     '10.json'
# ]

# Canvas sizes
NUM_CLIENTS = 16 
NUM_ROWS = 4
NUM_COLS = 3
CLIENT_WIDTH = 1920
CLIENT_HEIGHT = 1080
HORIZONTAL_BOUNDARIES = [-2160, -1080, 0, 1080, 2160] 
VERTICAL_BOUNDARIES = [-2880, -960, 960, 2880]
   
# Global statistics variables
lastRateTx = 0
timeOfLastTx = time.time()
txRate = 0

numTx = 0
numIn = 0
numOut = 0
numNodes = 0

txTotalVal = 0
txMaxVal = 0

txTotalFee = 0
txMaxFee = 0

txTotalSize = 0
txMaxSize = 0



def load_transaction_stats():
    global mean_tx, std_dev_tx, mean_balance, std_dev_balance
    with open('./server/transaction_stats.json') as f:
        transaction_stats = json.load(f)
        mean_tx = transaction_stats.get('mean_tx')
        std_dev_tx = transaction_stats.get('std_dev_tx')
        mean_balance = transaction_stats.get('mean_balance')
        std_dev_balance = transaction_stats.get('std_dev_balance')


def reset_server_state():
    global nodes, edges, node_ids, nx_graph, node_positions
    global numNodes, numTx, numIn, numOut, txTotalVal, txMaxVal, txTotalFee, txTotalSize, txMaxSize, numTx, lastRateTx, timeOfLastTx, txRate, current_addresses

    nodes = []
    edges = []
    node_ids = set()
    nx_graph.clear()  
    numNodes = 0
    numTx = 0
    numIn = 0
    numOut = 0
    txTotalVal = 0
    txMaxVal = 0
    txTotalFee = 0
    txMaxFee = 0
    txTotalSize = 0
    txMaxSize = 0
    numTx = 0
    lastRateTx = 0
    timeOfLastTx = time.time()
    txRate = 0
    current_addresses = {}
    balance_stats = {}

    print("Server state has been reset.")


def push(msg):
    global queue
    if len(queue) < MAX_SIZE:
        queue.append(msg)
    else:
        idx = next((i for i, item in enumerate(queue) if item.get('op') == 'utx'), -1)
        if idx < 0:
            if msg.get('op') == 'utx':
                return
            queue.append(msg)
        else:
            queue.pop(idx)
            queue.append(msg)


def shift():
    if queue:
        return queue.pop(0)
    return None

polling_ref = None


def start_polling():
    global polling_ref
    
    def poll():
        while True:
            if len(queue) == 0:
                time.sleep(0.5)
                continue
            message = shift()
            if message is None:
                continue
            # print("message: ", message)
            process_message([message])
            # print ("length of queue: ", len(queue))
            time.sleep(0.5)  # Polling interval

    if polling_ref is not None:
        polling_ref.cancel()
    
    polling_ref = threading.Thread(target=poll)
    polling_ref.daemon = True  # exits when the main program exits
    polling_ref.start()


def on_message(ws, message):
    # print("received websocket messages")
    data = json.loads(message)
    push(data)


def on_error(ws, error):
    print(f"WebSocket error: {error}")


def on_close(ws):
    global polling_ref
    print("WebSocket closed")
    if polling_ref is not None:
        polling_ref.cancel()


def on_open(ws):
    def run(*args):
        print("Connected to external Bitcoin WebSocket service")
        ws.send(json.dumps({"op": "unconfirmed_sub"}))
        print("subscribed to unconfirmed transactions")
        # ws.send(json.dumps({"op": "blocks_sub"}))
        # print("subscribed to new block notifications")
        start_polling()

    threading.Thread(target=run).start()


def start_ws():
    ws = websocket.WebSocketApp(BITCOIN_WS_URL,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)
    ws.on_open = on_open
    # websocket.enableTrace(True)
    print("Starting WebSocket connection to:", BITCOIN_WS_URL) 
    ws.run_forever()


def process_message(msg):
    global paused, msgBuf

    if paused:
        msgBuf.append(msg)
    else:
        # print (msg)
        if msg[0]["op"] == "utx":
            process_transaction(msg)
        elif msg[0]["op"] == "block":
            process_block(msg)


def process_transaction(transactions):
    # print ("-----------------------------")
    # print("transactions: ", transactions)
    # print("length of transacions: ", len(transactions))

    global nodes, edges, node_ids, nx_graph, address_dict, address_cache, current_addresses, balance_stats
    global numNodes, numTx, numIn, numOut, txTotalVal, txMaxVal, txTotalFee, txMaxFee, txTotalSize, txMaxSize, lastRateTx, timeOfLastTx, txRate

    new_nodes = []
    new_edges = []
    try:
        # print ("number of transactions: ", len(transactions))
        i = 1
        for tx in transactions:
            # if i == 1:
            #     print ("-----------------------------------")
            #     print ("transaction: ", tx)
            txIndex = random.randint(0, 100000000)
            tx['x']['tx_index'] = txIndex
            tx_id = tx['x']['tx_index']

            tx_hash = tx['x']['hash']
            tx_size = tx['x']['size']
            tx_time = tx['x']['time']
            tx_relayer = tx['x']['relayed_by']
            inputs = tx['x']['inputs']
            outputs = tx['x']['out']
            is_coinbase = tx['x'].get('is_coinbase', 0)
            
            orig_tx_color = '#ffffff'
            tx_color = '#ffffff'

            if tx_id not in node_ids:
                node = {
                    'id': tx_id, 
                    'label': tx_hash, 
                    'txHash': tx_hash,
                    'inVals': 0,
                    'outVals': 0,
                    'fee': 0,
                    'txtime': tx_time,
                    'size': 2500000000,
                    'bytesize': tx_size, 
                    'relayer': tx_relayer,
                    'orig_color': orig_tx_color,
                    'color': tx_color,
                    'type': 'tx'
                }
                nodes.append(node)
                new_nodes.append(node)
                node_ids.add(tx_id)
                nx_graph.add_node(tx_id)
                node_positions[tx_id] = (random.uniform(-1, 1), random.uniform(-1, 1))

                # print(f"Added transaction node: {tx_id}")

                # Update Statistics
                numNodes += 1
                numTx += 1
                # print ("Added tx node", numNodes)
                # graph_data = compute_graph(nodes, edges)
                # if graph_data:
                #     socketio.emit('graph_data', graph_data)
                #     print("emitted to client after processing transaction")


            inVals = 0
            # add orange inputs to graph
            for currInput in inputs:
                currInput['prev_out']['tx_index'] = random.randint(0, 100000000)
                currID = f"{currInput['prev_out']['tx_index']}:{currInput['prev_out']['n']}"
                addr = currInput['prev_out']['addr']
                size = currInput['prev_out']['value']
                z_score_tx = calculate_z_score(size, "tx")
                orig_in_color = '#FF9933'
                in_color = '#FF9933'
                
                existInput = nx_graph.nodes.get(currID)

                from_text = f" from {currInput['prev_out']['addr']}"

                if addr:
                    # if input has not already been seen since start of visualisation,
                    # add new node and edge to tx
                    if existInput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currInput['prev_out']['value'] * 1000 / 100000000:.2f}mB{from_text}",
                            'addr': addr, 
                            'size': size,
                            'z_score_tx': z_score_tx,
                            'z_score_balance': 0, # initialized to 0. will be retrieved in compute_graph()
                            'orig_in_color': orig_in_color,
                            'color': in_color, 
                            'type': 'input'
                        }
                        nodes.append(node)
                        new_nodes.append(node)
                        node_ids.add(currID)
                        nx_graph.add_node(currID)  

                        # # Add grey edges for addresses referenced by >1 input or output
                        # if addr in address_dict:
                        #     latest_node_id = address_dict[addr][-1]
                        #     edge = {
                        #         'id': f"{latest_node_id}:{currID}gray",
                        #         'source': latest_node_id,
                        #         'target': currID,
                        #         'color': '#555555',
                        #         'type': 'addr_link',
                        #         'weight': 30
                        #     }
                        #     edges.append(edge)
                        #     new_edges.append(edge)
                        #     # nx_graph.add_edge(latest_node_id, currID)
                        #     nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))
                        #     address_dict[addr].append(currID)
                        # else:
                        #     address_dict[addr] = [currID]
                        
                        edge = {
                            'id': f"{currID}:{tx_id}",
                            'source': currID, 
                            'target': tx_id, 
                            'orig_in_color': orig_in_color,
                            'color': in_color, 
                            'type': 'in_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx
                            }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(currID, tx_id)
                        # nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))

                        node_positions[currID] = (random.uniform(-1, 1), random.uniform(-1, 1))

                        # Update statistics
                        numNodes += 1
                        numIn += 1

                        # print ("Added input node", numNodes)
                        # print(f"Added new input node: {currID}")
                        # print(f"Added input edge: {currID} -> {tx_id}")

                        # graph_data = compute_graph(nodes, edges)
                        # if graph_data:
                        #     socketio.emit('graph_data', graph_data)
                        #     print("emitted to client after processing transaction")

                    else:
                        existInput['type'] = 'InOut'

                        edge = {
                            'id': "{currID}:{tx_id}joinToExistIn",
                            'source': currID, 
                            'target': tx_id, 
                            'orig_in_color': orig_in_color,
                            'color': in_color,
                            'type': 'in_link',
                            'weight': 20,
                            'size': size,
                            'z_score_tx': z_score_tx
                            }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(currID, tx_id)
                        # nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))

                        # print('Joined input node:', currID)
                        # graph_data = compute_graph(nodes, edges)
                        # if graph_data:
                        #     socketio.emit('graph_data', graph_data)
                        #     print("emitted to client after processing transaction")
                    inVals += size

                        
            outVals = 0
            # add blue outputs to graph
            for currOutput in outputs:
                currOutput['tx_index'] = random.randint(0, 100000000)
                currID = f"{currOutput['tx_index']}:{currOutput['n']}"
                size = currOutput['value']
                z_score_tx = calculate_z_score(size, "tx")
                addr = currOutput['addr']
                to_text = f" to {currOutput['addr']}"

                orig_out_color = '#003399'
                out_color = '#003399'

                existOutput = nx_graph.nodes.get(currID)

                # if addr is None:
                #     print(f"Skipping output with None address: {currID}")

                if addr:
                    if existOutput is None:
                        node = {
                            'id': currID, 
                            'label': f"{currOutput['value'] * 1000 / 100000000:.2f}mB{to_text}",
                            'addr': addr, 
                            'tag' :currOutput.get('addr_tag'), 
                            'size': size, 
                            'z_score_tx': z_score_tx,
                            'z_score_balance': 0, # initialized to 0. will be retrieved in compute_graph()
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'output'
                        }
                        nodes.append(node)
                        new_nodes.append(node)
                        node_ids.add(currID)
                        nx_graph.add_node(currID)

                        # #Add grey edges for addresses referenced by >1 input or output
                        # if addr in address_dict:
                        #     latest_node_id = address_dict[addr][-1]
                        #     edge = {
                        #         'id': f"{latest_node_id}:{currID}gray",
                        #         'source': latest_node_id,
                        #         'target': currID,
                        #         'color': '#555555',
                        #         'type': 'addr_link',
                        #         'weight': 30
                        #     }
                        #     edges.append(edge)
                        #     new_edges.append(edge)
                        #     # nx_graph.add_edge(latest_node_id, currID)
                        #     nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))
                        #     address_dict[addr].append(currID)
                        # else:
                        #     address_dict[addr] = [currID]

                        edge = {
                            'id': f"{tx_id}:{currID}",
                            'source': tx_id, 
                            'target': currID,  
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'out_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)
                        # nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))

                        node_positions[currID] = (random.uniform(-1, 1), random.uniform(-1, 1))

                        # Update statistics
                        numNodes += 1
                        numOut += 1
                        # print ("Added output node", numNodes)
                        # print(f"Added new output node: {currID}")
                        # print(f"Added output edge: {tx_id} -> {currID}")
                        # graph_data = compute_graph(nodes, edges)
                        # if graph_data:
                        #     socketio.emit('graph_data', graph_data)
                        #     print("emitted to client after processing transaction")

                    else:
                        existOutput['type'] = 'InOut'
                        edge = {
                            'id': f"{tx_id}:{currID}joinToExistOut",
                            'source': tx_id, 
                            'target': currID,  
                            'orig_out_color': orig_out_color,
                            'color': out_color, 
                            'type': 'out_link',
                            'weight': 5,
                            'size': size,
                            'z_score_tx': z_score_tx
                        }
                        edges.append(edge)
                        new_edges.append(edge)
                        nx_graph.add_edge(tx_id, currID)
                        # nx_graph.add_edge(edge['source'], edge['target'], weight=edge.get('weight', 1))

                        # print('Joined output node:', currID)
                        # graph_data = compute_graph(nodes, edges)
                        # if graph_data:
                        #     socketio.emit('graph_data', graph_data)
                        #     print("emitted to client after processing transaction")
                    outVals += size

            # Update transaction node values
            tx_fee = max(inVals - outVals, 0)
            tx_label = f'{outVals * 1000 / 100000000:.2f}mB + {tx_fee * 1000 / 100000000:.2f}mBFee {tx_id}'
            nodes[-1]['inVals'] = inVals
            nodes[-1]['outVals'] = outVals
            nodes[-1]['fee'] = tx_fee
            nodes[-1]['label'] = tx_label

            txTotalVal += outVals
            txMaxVal = max(txMaxVal, outVals)
            txTotalFee += tx_fee
            txMaxFee = max(txMaxFee, tx_fee)
            txTotalSize += tx_size
            txMaxSize = max(txMaxSize, tx_size)

            # For every 10 transactions
            if numTx - lastRateTx >= 10:
                # Update txRate
                txRate = 10 / ((time.time() - timeOfLastTx) / 1000)
                timeOfLastTx = time.time()
                lastRateTx = numTx

                # Emit txRate to update tx rate line graph
                tx_rate = {
                    'txRate': round(txRate, 2)
                }

                socketio.emit('tx_rate_stats', tx_rate)

                if current_addresses:
                    # Update statistics of address balances
                    update_address_balance_stats()

            # After updating the variables, emit the updated statistics to the clients 
            statistics = {
                'numNodes': numNodes,
                'numTx': numTx,
                'numIn': numIn,
                'numOut': numOut,
                'txTotalVal': txTotalVal,
                'txMaxVal': txMaxVal,
                'txTotalFee': txTotalFee,
                'txMaxFee': txMaxFee,
                'txTotalSize': txTotalSize,
                'txMaxSize': txMaxSize,
                'txRate': round(txRate, 2)
            }
            statistics.update(balance_stats)

            socketio.emit('update_stats', statistics)
             
            # Emit updated statistics to clients rendering histograms and line graphs
            graph_stats = {
                'txVal': outVals * 1000 / 100000000,
                'txSize': tx_size,
                'txAvgFee': txTotalFee / numTx * 1000 / 100000000,
            }

            socketio.emit('stats', graph_stats)
        # Compute positions and send graph data after processing each transaction
        # graph_data = compute_graph(nodes, edges)
        # if graph_data:
        #     socketio.emit('graph_data', graph_data)
        #     print("emitted to client after processing transaction")

        # Get balance of each address
        global addresses_to_query

        # print ("---------number of global addresses to query-----------", len(addresses_to_query))
        for node in new_nodes:
            # only input and output nodes can have addresses
            if (node['type'] != "tx" and node['type'] != "intersection"):
                address = node['addr']
                if address: 
                    # if address is not in cache, append it to the list to be queried using API
                    if address not in address_cache:
                        addresses_to_query.append(address)
                    # if address is already in cache, update the cached value
                    else:
                        transaction_value = node['size']
                        update_cache(address, transaction_value, "cache")
                        update_cache(address, transaction_value, "current")

        if len(addresses_to_query) >= 50:
            # print("-----------quering: ", len(addresses_to_query))
            new_balances = get_address_balances(addresses_to_query)
            address_cache.update(new_balances)
            current_addresses.update(new_balances)
            addresses_to_query = []

        # compute_graph(new_nodes, new_edges)

    except Exception as e:
        print("Error processing transactions:", str(e))
        traceback.print_exc()


def process_block(msg):
    global nodes, edges, node_ids, nx_graph
    global numNodes, numTx
    global paused, blkTimer, blkStart

    paused = True
    print(f'New block {msg[0]["x"]["height"]} received')

    # Update timers and alerts (if needed)
    blkStart = time.time()
    # Clear and set blkTimer (need to implement timeBlock logic)
    # blkTimer = setInterval(timeBlock, 1000, [blkStart])

    txs = msg[0]["x"]["txIndexes"]

    preBlockTxCount = numTx
    nodes_to_drop = set()

    for tx_id in txs:
        if tx_id in node_ids:
            # Drop all connected nodes
            nodes_to_drop.update(drop_connected(tx_id))
            # Drop tx node itself
            numTx -= 1
            numNodes -= 1
            nodes_to_drop.add(tx_id)

    print(f'{preBlockTxCount - numTx} txs removed')

    # Send nodes to drop to client
    socketio.emit('drop_nodes', list(nodes_to_drop))
    paused = False


def calculate_z_score(value, type):
    global mean_tx, std_dev_tx, mean_balance, std_dev_balance
    if type == "tx":
        return (value - mean_tx) / std_dev_tx
    elif type == "balance":
        return (value - mean_balance) / std_dev_balance


def drop_connected(tx_id):
    nodes_to_drop = set()
    txnbrs = nx_graph.adj[tx_id]

    for txnbr in txnbrs:
        is_to_drop = True
        nbrsnbrs = nx_graph.adj[txnbr]

        for nbrsnbr in nbrsnbrs:
            for edg in nx_graph.edges(nbrsnbr):
                if edg[0] != tx_id and edg[1] != tx_id and nx_graph.edges[edg]['type'] != 'addr_link':
                    is_to_drop = False

        if is_to_drop:
            nodes_to_drop.add(txnbr)
            nx_graph.remove_node(txnbr)

    return nodes_to_drop


def get_address_balances(addresses):
    url = f"https://blockchain.info/multiaddr?active={'|'.join(addresses)}&n=0"
    response = requests.get(url)
    if response.status_code == 200:
        data = response.json()
        balances = {addr['address']: addr['final_balance'] / 1e8 for addr in data['addresses']}  # Convert from satoshis to BTC
        return balances
    else:
        print("Error fetching balances:", response.status_code)
        return {}


def update_cache(address, transaction_value, type):
    global address_cache, current_addresses
    if type == "cache":
        if address in address_cache:
            address_cache[address] += transaction_value
        else:
            address_cache[address] = transaction_value
    elif type == "current":
        if address in current_addresses:
            current_addresses[address] += transaction_value
        else:
            current_addresses[address] = transaction_value


def update_address_balance_stats():
    global current_addresses, balance_stats

    # Get all balance values from the dictionary
    balances = np.array(list(current_addresses.values()))
    
    # Calculate the required statistics
    median_balance = np.median(balances)
    percentile_25th = np.percentile(balances, 25)
    percentile_75th = np.percentile(balances, 75)
    iqr = percentile_75th - percentile_25th
    max_balance = np.max(balances)

    # Update balance stats
    balance_stats["balanceMed"] = int(median_balance)
    balance_stats["balanceIQR"] = int(iqr)
    balance_stats["balanceMax"] = int(max_balance)


# def compute_graph(new_nodes, new_edges):
#     global nx_graph, node_positions, scale_factor
#     total_iterations = 2000
#     batch_size = 50
#     # nx_graph_copy = copy.deepcopy(nx_graph)

#     try:
#         forceatlas2 = ForceAtlas2(
#             outboundAttractionDistribution=False,
#             linLogMode=False,
#             adjustSizes=False,
#             edgeWeightInfluence=1.0,
#             jitterTolerance=0.5,
#             barnesHutOptimize=True,
#             barnesHutTheta=1.0,
#             multiThreaded=False,
#             scalingRatio=40.0,
#             gravity=10.0,
#             strongGravityMode=False,
#             verbose=True
#         )

#         for i in range(0, total_iterations, batch_size):
#             if not nx_graph.nodes or not nx_graph.edges:
#                 print("Graph is empty, exiting compute_graph function.")
#                 return

#             positions = forceatlas2.forceatlas2_networkx_layout(nx_graph, pos=None, iterations=batch_size)
#             # print ("\n")
#             # print ("length of positions: ", len(positions))
#             # print (positions)

#             partial_graph_data = create_graph_data(new_nodes, new_edges, positions)

#             start_time = time.time()
#             socketio.emit('graph_data', partial_graph_data)
#             end_time = time.time()
#             emit_duration = end_time - start_time
#             print(f"Emitted partial graph data after {i + batch_size} iterations in {emit_duration:.4f} seconds")
#             time.sleep(1.6)

#         return create_graph_data(new_nodes, new_edges, positions)

#     except Exception as e:
#         print("Error rendering graph:", str(e))
#         traceback.print_exc()
#         return {'nodes': [], 'edges': []}


def compute_graph(new_nodes, new_edges):
    global nx_graph, node_positions, scale_factor

    total_iterations = 80
    batch_size = 1  # Run one iteration at a time

    try:
         # Initialize node_positions if it's not already done, or update with any new nodes
        if node_positions is None:
            node_positions = {node: (random.uniform(-1, 1), random.uniform(-1, 1)) for node in nx_graph.nodes()}
        else:
            # Ensure all nodes in the graph have a valid entry in node_positions
            # for node in nx_graph.nodes():
            for node in new_nodes:
                node_id = node['id']
                if node_id not in node_positions or node_positions[node_id] == (0.0, 0.0):
                    # print ("initialise node position")
                    node_positions[node_id] = (random.uniform(-1, 1), random.uniform(-1, 1))

        # Initialize ForceAtlas2 with the desired parameters
        forceatlas2 = ForceAtlas2(
            outboundAttractionDistribution=False,
            linLogMode=False,
            adjustSizes=False,
            edgeWeightInfluence=1.0,
            jitterTolerance=0.5,
            barnesHutOptimize=True,
            barnesHutTheta=1.0,
            multiThreaded=False,
            scalingRatio=35.0,
            strongGravityMode=False,
            gravity=20.0,
            verbose=False
        )

        # Loop over the total number of iterations
        for i in range(total_iterations):
            if not nx_graph.nodes or not nx_graph.edges:
                print("Graph is empty, exiting compute_graph function.")
                return

            # Run ForceAtlas2 for one iteration, starting with the current node positions
            positions = forceatlas2.forceatlas2_networkx_layout(nx_graph, pos=node_positions, iterations=batch_size)

            # print ("-------------RAW POSITIONS---------------------")
            # print (positions)

            # Update the global node positions with the new positions calculated by ForceAtlas2
            node_positions.update(positions)
            
            scaled_positions = node_positions.copy()
            for node_id in scaled_positions:
                x, y = scaled_positions[node_id]
                scaled_positions[node_id] = (x * scale_factor, y * scale_factor)

            # print(f"Completed iteration {i + 1}/{total_iterations}")

        # After all iterations, create and emit the final graph data
        final_graph_data = create_graph_data(new_nodes, new_edges, scaled_positions)

        socketio.emit('graph_data', final_graph_data)
        print(f"Completed {total_iterations} iteration ")

        return final_graph_data

    except Exception as e:
        print("Error rendering graph:", str(e))
        traceback.print_exc()
        return {'nodes': [], 'edges': []}
    

def create_graph_data(new_nodes, new_edges, positions):
    global scale_factor

    new_edges_split = []
    all_x_values = []
    all_y_values = []
    outside_x_range = 0
    outside_y_range = 0

    for edge in new_edges:
        if edge['source'] in positions and edge['target'] in positions:
            source_pos = positions[edge['source']]
            target_pos = positions[edge['target']]

             # Collecting x and y values
            all_x_values.append(source_pos[0])
            all_x_values.append(target_pos[0])
            all_y_values.append(source_pos[1])
            all_y_values.append(target_pos[1])

            intersections = []

            for boundary in VERTICAL_BOUNDARIES:
                if min(source_pos[0], target_pos[0]) < boundary < max(source_pos[0], target_pos[0]):
                    intersection = compute_intersection(source_pos, target_pos, boundary, True)
                    if intersection:
                        intersections.append(intersection)


            for boundary in HORIZONTAL_BOUNDARIES:
                if min(source_pos[1], target_pos[1]) < boundary < max(source_pos[1], target_pos[1]):
                    intersection = compute_intersection(source_pos, target_pos, boundary, False)
                    if intersection:
                        intersections.append(intersection)


            intersections.sort(key=lambda p: ((p[0] - source_pos[0])**2 + (p[1] - source_pos[1])**2)**0.5)
            last_node_id = edge['source']
            
            
            if intersections:
                for i, intersection in enumerate(intersections):
                    intersection_id = f"intersection_{edge['source']}_{edge['target']}_{i}"
                    positions[intersection_id] = intersection

                    all_x_values.append(intersection[0])
                    all_y_values.append(intersection[1])

                    new_edges_split.append({
                        'source': last_node_id,
                        'target': intersection_id,
                        'type': edge['type'],
                        'color': edge['color'],
                        'size': edge['size'],
                        'z_score_tx': edge['z_score_tx']
                    })
                    new_nodes.append({'id': intersection_id, 'x': intersection[0], 'y': intersection[1], 'color': '#000000', 'type': 'intersection'})

                    last_node_id = intersection_id

                new_edges_split.append({
                    'source': last_node_id,
                    'target': edge['target'],
                    'type': edge['type'],
                    'color': edge['color'],
                    'size': edge['size'],
                    'z_score_tx': edge['z_score_tx']
                })
            else:
                new_edges_split.append(edge)

    # Determine the range of x and y values
    x_min, x_max = min(all_x_values), max(all_x_values)
    y_min, y_max = min(all_y_values), max(all_y_values)

     # Calculate scaling factors for x and y
    # x_scale_factor = (2880 * 2) / (x_max - x_min)
    # y_scale_factor = (2160 * 2) / (y_max - y_min)

    # Choose the smaller scaling factor to maintain aspect ratio
    # scale_factor = min(x_scale_factor, y_scale_factor)
    # scaled_x_values = [(x - x_min) * scale_factor - 2880 for x in all_x_values]
    # scaled_y_values = [(y - y_min) * scale_factor - 2160 for y in all_y_values]

    for x in all_x_values:
        if x < -2880 or x > 2880:
            outside_x_range += 1

    for y in all_y_values:
        if y < -2160 or y > 2160:
            outside_y_range += 1

    # Print the range of x and y values and how many are outside the boundaries
    print(f"X range: ({x_min}, {x_max})")
    print(f"Y range: ({y_min}, {y_max})")
    print(f"Nodes outside X range: {outside_x_range}")
    print(f"Nodes outside Y range: {outside_y_range}")

    graph_data = {
        'nodes': [{'id': node['id'], 
                   'x': positions[node['id']][0], 
                   'y': positions[node['id']][1], 
                    # 'x': (positions[node['id']][0] - x_min) * scale_factor -2880, 
                    # 'y': (positions[node['id']][1] - y_min) * scale_factor -2160, 
                   'color': node['color'], 
                   'type': node['type'], 
                   'size': node['size'] if node['type'] != 'intersection' else None,
                   'z_score_tx': node['z_score_tx'] if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                   'balance': address_cache.get(node['addr'], 0) if node['type'] != 'tx' and node['type'] != 'intersection' else None,
                   'z_score_balance': calculate_z_score(np.log1p(address_cache.get(node['addr'], 0)), "balance") if node['type'] != 'tx' and node['type'] != 'intersection' else None
                 } for node in new_nodes if node['id'] in positions],
        'edges': [{'source': edge['source'], 
                   'target': edge['target'], 
                   'color': edge['color'], 
                   'type': edge['type'],
                   'size': edge['size'],
                   'z_score_tx': edge['z_score_tx']} 
                   for edge in new_edges_split]
    }
    return graph_data


def compute_intersection(p1, p2, boundary, is_vertical):
    x1, y1 = p1
    x2, y2 = p2
    if is_vertical:
        if x1 == x2:
            return None  # Avoid division by zero
        y = y1 + (boundary - x1) * (y2 - y1) / (x2 - x1)
        return (boundary, y)
    else:
        if y1 == y2:
            return None  # Avoid division by zero
        x = x1 + (boundary - y1) * (x2 - x1) / (y2 - y1)
        return (x, boundary)


@app.route('/static/<path:path>', methods=['GET'])
def static_proxy(path):
    return send_from_directory(app.static_folder, path)


@app.route('/', methods=['GET'])
def index():
    return render_template('mempool.html')


@app.route('/controller')
def controller():
    return render_template('controller.html')


@app.route('/tx_value')
def tx_value():
    return render_template('tx_value_histogram.html')


@app.route('/tx_size')
def tx_size():
    return render_template('tx_size_histogram.html')


@app.route('/tx_fee')
def tx_fee():
    return render_template('tx_fee_lineGraph.html')


@app.route('/tx_rate')
def tx_rate():
    return render_template('tx_rate_lineGraph.html')


@app.route('/static_graph', methods=['GET'])
def static_graph():
    snapshot = request.args.get('snapshot', 'saved_graph.json')
    return render_template('static_graph.html', snapshot=snapshot)


@app.route('/static_histogram', methods=['GET'])
def static_histogram():
    snapshot = request.args.get('snapshot')
    histogram_type = request.args.get('histogramType', 'tx_value')
    return render_template('static_histogram.html', snapshot=snapshot, histogramType=histogram_type)


@app.route('/static_lineGraph', methods=['GET'])
def static_line_graph():
    snapshot = request.args.get('snapshot')
    line_graph_type = request.args.get('lineGraphType', 'tx_fee')
    return render_template('static_lineGraph.html', snapshot=snapshot, lineGraphType=line_graph_type)


@app.route('/save_snapshot', methods=['POST'])
def save_snapshot():
    print("SAVING SNAPSHOTS")
    graph_data = request.json
    filename = request.args.get('filename')

    # Call the function to accumulate data
    accumulate_graph_data(graph_data, filename)

    return jsonify({"status": "success"})


def accumulate_graph_data(new_data, filename):
    global graph_data_accumulated, clients_received

    with save_lock:

        # Accumulate nodes and edges if present
        if "nodes" in new_data:
            graph_data_accumulated["nodes"].extend(new_data["nodes"])
        if "edges" in new_data:
            graph_data_accumulated["edges"].extend(new_data["edges"])

        # Accumulate stats if present
        if "stats" in new_data and new_data["stats"]:
            graph_data_accumulated['stats'] = new_data['stats']

        # Accumulate histograms if present
        if "histograms" in new_data and new_data["histograms"]:
            for key, value in new_data["histograms"].items():
                if key in graph_data_accumulated["histograms"]:
                    graph_data_accumulated["histograms"][key].extend(value)
                else:
                    graph_data_accumulated["histograms"][key] = value

        # Accumulate line graphs if present
        if "lineGraphs" in new_data and new_data["lineGraphs"]:
            for key, value in new_data["lineGraphs"].items():
                if key in graph_data_accumulated["lineGraphs"]:
                    graph_data_accumulated["lineGraphs"][key].extend(value)
                else:
                    graph_data_accumulated["lineGraphs"][key] = value

        clients_received += 1
        print(f"Received data from client {clients_received}/{NUM_CLIENTS}")

        # Only save to file when all clients have submitted their data
        if clients_received == NUM_CLIENTS:
            file_path = os.path.join(app.static_folder, 'snapshots', filename)
            try:
                with open(file_path, 'w') as f:
                    print("All client data received. Writing to file...")
                    json.dump(graph_data_accumulated, f, indent=4)
                    print("Graph snapshot saved successfully.")
            except Exception as e:
                print("Error saving graph snapshot:", str(e))
            finally:
                # Reset for next snapshot
                graph_data_accumulated = {
                    "nodes": [],
                    "edges": [],
                    "stats": {},
                    "histograms": {},
                    "lineGraphs": {}
                }
                clients_received = 0


@app.route('/list_snapshots', methods=['GET'])
def list_snapshots():
    snapshots = []
    snapshots_folder = os.path.join(app.static_folder, 'snapshots')

    for file_name in os.listdir(snapshots_folder):
        if file_name.startswith("graph_snapshot_") and file_name.endswith(".json"):
            with open(os.path.join(snapshots_folder, file_name), 'r') as f:
                graph_data = json.load(f)
                stats = graph_data.get('stats', {})
                snapshots.append({
                    'file_name': file_name,
                    'stats': stats
                })
    return jsonify(snapshots)


@app.route('/snapshot_stats', methods=['GET'])
def snapshot_stats():
    snapshot = request.args.get('snapshot', 'saved_graph.json')
    file_path = os.path.join(app.static_folder, 'snapshots', snapshot)
    try:
        with open(file_path, 'r') as f:
            graph_data = json.load(f)
            stats = graph_data.get('stats', {})
            timestamp = snapshot.replace('graph_snapshot_', '').replace('.json', '')
            return render_template('snapshot_info.html', stats=stats, timestamp=timestamp)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@socketio.on('controller_command')
def handle_controller_command(data):
    print ("Received controller command")
    global start_visualization

    action = data.get('action')
    if action == 'startVisualization':
        with start_lock:
            start_visualization = True
            threading.Thread(target=start_ws).start()
            threading.Thread(target=periodic_broadcast).start()
            print("Visualization started.")

    elif action == 'resetGraph':
        with start_lock:
            if start_visualization:
                print("Reset graph command received.")
                reset_server_state()
                socketio.emit('reload')  
    elif action == 'saveSnapshot':
          emit('controller_command', data, broadcast=True)


@socketio.on('connect')
def handle_connect():
    print('Client connected') 
    emit('connection_response', {'data': 'Connected to server'})


@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')


def periodic_broadcast():
    global nodes, edges, start_visualization, numNodes
    while True:
        with start_lock:
            if not start_visualization:
                time.sleep(0.5)  # Check every second to see if the visualization has started
                continue

        with queue_lock:
            if not queue:
                continue
            # new_nodes, new_edges = process_transaction(transactions)
            # graph_data = compute_graph(new_nodes, new_edges)
            if not nodes and not edges:
                print("Graph has no nodes or edges yet.")
                time.sleep(broadcast_interval)
                continue

            # Check if the number of nodes exceeds the threshold
            if numNodes > 1000:
                print("Number of nodes exceeds threshold, resetting server state.")
                reset_server_state()
                socketio.emit('reload')
                continue

            graph_data = compute_graph(nodes, edges)
            # graph_data = compute_graph_safe(nodes, edges)

            start_time = time.time()
            socketio.emit('graph_data', graph_data)
            end_time = time.time()
            emit_duration = end_time - start_time
            print ("---------------------------------------")
            print(f"Emitted to client in {emit_duration:.4f} seconds")

         # Save graph_data to a local JSON file with sequential names
        # filename = f"{counter}.json"
        # with open(filename, 'w') as f:
        #     json.dump(graph_data, f, indent=4)
        # counter += 1

        time.sleep(broadcast_interval)

## For Testing only
def send_json_files():
    global file_index, json_files
    while file_index < len(json_files):
        with open(json_files[file_index]) as f:
            graph_data = json.load(f)
            socketio.emit('graph_data', graph_data)
            print("emitted to client")
        file_index += 1
        time.sleep(broadcast_interval) 


if __name__ == '__main__':
    load_transaction_stats()
    print("Starting Flask server on 0.0.0.0:3000")
    # threading.Thread(target=start_ws).start()
    # threading.Thread(target=periodic_broadcast).start()
    # threading.Thread(target=send_json_files).start()
    # socketio.run(app, host='2a0c:5bc0:40:2e26:4961:8fe2:345d:7569', port=3000)
    socketio.run(app, host='0.0.0.0', port=3000)