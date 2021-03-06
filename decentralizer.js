var fs = require('fs');
var sia = require('sia.js');
var http = require('request');

// Passing arguments
var argument1 = process.argv[2]
var argument2 = process.argv[3]

console.log()
console.log("*** KEOPS DECENTRALIZER v0.1.0 ***")

if (argument1 == "scan") {
    siaContracts()
} else if (argument1 == "remove") {
    removeContract(argument2)
} else if (argument1 == "test") {
    removeTest(argument2)
} else {
    console.log("Invalid syntax")
    console.log("   * decentralizer scan --> Analyzes contracts and shows host belonging farms, numbering the hosts")
    console.log("   * decentralizer remove x --> Removes the host number 'x' (refer to the previous list) from your contracts")
    console.log("   * decentralizer remove auto --> Removes all the duplicate hosts in a farm, leaving only one host per farm (the one holding more data)")
    console.log()
}


function siaContracts() {
    // 1 - Connect to Sia and retrieve contracts
    // 2 - Get IPs of the hosts
    // 3 - Arrange them as farms

    // Requesting the contracts list with an API call:
    console.log("Connecting to Sia...")
    sia.connect('localhost:9980')
    .then((siad) => {siad.call('/renter/contracts')
        .then((contractsAPI) => {
            var contracts = contractsAPI.contracts
            var i = 0
            console.log("Geolocating hosts:\n")
            requestIP(contracts, i)
        })
        .catch((err) => {
            console.log("Error retrieving data from Sia (is Sia working, synced and connected to internet? Try also this script again after restarting Sia)")
            console.log()
        })
    })
    .catch((err) => {
        console.log("Error connecting to Sia. Start the Sia app (either daemon or UI) or try again")
        console.log()
    })
}


function requestIP(contracts, i) {
    // First checking that the contract is active (Sia returns active and inactive all together)
    if (contracts[i].goodforupload == false && contracts[i].goodforrenew == false) {
        // Move to the next contract. First splice the contract from the list and reduce the i to not skip one contract
        contracts.splice(i, 1)
        i--
        nextIP(contracts, i)
    } else {
        // Triming the ":port" from the host IP
        var hostip = contracts[i].netaddress
        var s = hostip.search(":")
        var totrim = hostip.length - s
        trimedip = hostip.slice(0, -totrim)
        
        // Requesting the geolocation of the host
        var ipquery = "http://ip-api.com/json/" + trimedip
        http.get(ipquery).on('response', function (response) {
            var body4 = '';
            var i4 = 0;
            response.on('data', function (chunk4) {
                i4++;
                body4 += chunk4;
            });
            response.on('end', function () {
                var ipAPI = JSON.parse(body4)
                var lat = parseFloat(ipAPI.lat)
                var lon = parseFloat(ipAPI.lon)
                process.stdout.clearLine();  // clear current text
                process.stdout.cursorTo(0);  // move cursor to beginning of line
                process.stdout.write("(" + (i+1) + "/" + contracts.length + ") - " + hostip)
                //console.log("(" + (i+1) + "/" + contracts.length + ") - " + hostip)
                contracts[i].lon = lon
                contracts[i].lat = lat
                nextIP(contracts, i)
            })
            response.on('error', function (chunk5) {
                // On failed IP request, move to the next IP
                console.log(hostip + " - Failed")
                nextIP(contracts, i)
            });
        })
    }
}

function nextIP(contracts, i) {
    setTimeout(function(){ // 500ms cooldown, to avoid being banned by ip-api.com
        i++
        if (i < contracts.length) {
            requestIP(contracts, i)
        } else {
            processHosts(contracts)
        }
    }, 500);
}

function processHosts(contracts) {
    console.log("\nAnalysis of hosts done. Number of active contracts: " + contracts.length)

    // Finding centralized farms
    var hostsGroups = []
    for (var i = 0; i < contracts.length; i++) { // For each contrct
        var hostInGroupBool = false
        for (var j = 0; j < hostsGroups.length; j++) {
            if (contracts[i].lat == hostsGroups[j][0].lat && contracts[i].lon == hostsGroups[j][0].lon) { // Checking if geolocation is the same as the first element in a group
                hostsGroups[j].push(contracts[i]) // Add host to the group
                hostInGroupBool = true
                //console.log("New farm member identified")
            }
        }
        if (hostInGroupBool == false) {
            var newGroup = [contracts[i]]
            hostsGroups.push(newGroup) // Add a new group
        }
    }

    // Rearranging the array
    var farmNumber = 1
    var farmList = [{ // Initializing array
        farm: "Other hosts",
        hosts: []
    },{
        farm: "Geolocation unavailable",
        hosts: []
    }]
    for (var j = 0; j < hostsGroups.length; j++) {
        if (hostsGroups[j].length > 1) { // Only groups with more than one member: hosting farms
            var farmEntry = {
                farm: "Host farm #" + (farmNumber),
                hosts: []
            }
            for (var k = 0; k < hostsGroups[j].length; k++) {
                var hostEntry = {
                    ip: hostsGroups[j][k].netaddress,
                    contract: hostsGroups[j][k].id,
                    cost: parseFloat((hostsGroups[j][k].totalcost/1000000000000000000000000).toFixed(2)),
                    data: parseFloat((hostsGroups[j][k].size/1000000000).toFixed(2)) // In GB
                }
                farmEntry.hosts.push(hostEntry)
            }
            // Arrange the hosts by stored data
            function compare(a,b) {
                if (a.data < b.data)
                    return 1;
                if (a.data > b.data)
                    return -1;
                return 0;
            }
            farmEntry.hosts.sort(compare);
            
            // Push data
            if (hostsGroups[j][0].lat > 0) { // Geolocation is a number
                farmList.push(farmEntry)
                farmNumber++
            } else { // Geolocation unavailable. Replace element 1 by this
                farmList[1].hosts = farmEntry.hosts
            }
            
        
        } else { // Individual hosts
            var hostEntry = {
                ip: hostsGroups[j][0].netaddress,
                contract: hostsGroups[j][0].id,
                cost: parseFloat((hostsGroups[j][0].totalcost/1000000000000000000000000).toFixed(2)),
                data: parseFloat((hostsGroups[j][0].size/1000000000).toFixed(2)) // In GB
            }
            // Pushing it to the element 0 of farmList, the "Other hosts"
            farmList[0].hosts.push(hostEntry)
        }
    }

    // Saving the file
    var stream = fs.createWriteStream('farms.json')
    var string = JSON.stringify(farmList)
    stream.write(string)

    showFarms(farmList)
}


function showFarms(farmList) {
    console.log("--------------------------------------------")
    var listNumber = 1
    for (var i = 1; i < farmList.length; i++) {
        if (farmList[i].hosts.length > 0) { // For not displaying the not geolocated if there is no host in this category
            console.log("- " + farmList[i].farm + ":")
            for (var j = 0; j < farmList[i].hosts.length; j++) {
                console.log("     * [" + listNumber + "] " + farmList[i].hosts[j].ip + " - Value: " + farmList[i].hosts[j].cost + "SC - Data: " + farmList[i].hosts[j].data + "GB")
                listNumber++
            }
        }
    }
    if (farmList.length <= 2) {
        console.log("No host farms have been found in your contracts list")
    }
    console.log("--------------------------------------------")
    if (farmList.length > 2) {
        console.log("Scan complete. Use 'decentralizer remove auto' to remove all the hosts in farms (and not geolocated) with the exception of the top one, or 'decentralizer remove x' for manually removing a host, where x is the number indicated in brackets")
    }
    console.log()
}


function removeContract(argument2) {
    if (argument2 > 0 || argument2 == "auto") {
        // Open "farms.json" file
        var stream1 = fs.createReadStream('farms.json')
        var data= ''
        var chunk
        stream1.on('readable', function() { //Function just to read the whole file before proceeding
            while ((chunk=stream1.read()) != null) {
                data += chunk;}
        });
        stream1.on('end', function() {
            if (data != "") {
                var farmList = JSON.parse(data)
            } else {
                var farmList = []
            }

            var contractsToRemove = []
            var hostCount = 1 // Start in 1 the counting
            for (var i = 1; i < farmList.length; i++) { // Starts in 1, as "1" is the other hosts
                for (var j = 0; j < farmList[i].hosts.length; j++) {
                    if (j != 0 && argument2 == "auto") { // If auto mode and it is not the top host of the farm, add it
                        contractsToRemove.push({
                            ip: farmList[i].hosts[j].ip,
                            contract: farmList[i].hosts[j].contract
                        })
                    } else if (argument2 == hostCount) { // If manual mode, if the number is a match add it
                        contractsToRemove.push({
                            ip: farmList[i].hosts[j].ip,
                            contract: farmList[i].hosts[j].contract
                        })
                    }
                    hostCount++
                }
            }
            if (contractsToRemove.length > 15) {
                console.log("WARNING: Removing this amount of hosts in a single action can provoke data loss if you do not have the files locally anymore. It is recommended instead to remove a smaller (<15) number of hosts and allow file redundancy repair to 3x before proceeding with the next batch of hosts to remove. Proceed only at your own risk")
                console.log()
                console.log("This will remove " + contractsToRemove.length + " contracts with hosts. Proceed? (y/n)")
            } else if (contractsToRemove.length == 1) {
                console.log("This will remove the contract with host: " + contractsToRemove[0].ip + " - Proceed? (y/n)")
            } else if (contractsToRemove.length == 0) {
                console.log("No contracts to be removed with the selected parameters")
                console.log()
            } else {
                console.log("This will remove " + contractsToRemove.length + " contracts with hosts. Proceed? (y/n)")
            }

            if (contractsToRemove.length > 0) {
                // Input form for confirmation
                var stdin = process.stdin;
                stdin.setRawMode( true );
                stdin.resume();
                stdin.setEncoding( 'utf8' );
                stdin.on( 'data', function( key ){
                    if ( key === '\u0003' ) { // ctrl-c
                        process.exit();
                    } else if (key === 'y') {
                        var contractNum = 0
                        var attempt = 0
                        cancelContract(contractNum, contractsToRemove, attempt)
                    } else if (key === 'n') {
                        console.log()
                        process.exit();
                    }
                    //process.stdout.write( key );
                });
            }

        })
        stream1.on('error', function() {
            console.log("Error: Decentralizer needs to scan the contracts in first place. Run 'decentralizer scan' first")
            console.log()
        })
    } else {
        // Error
        console.log("Invalid syntax")
        console.log("   * decentralizer scan --> Analyzes contracts and shows host belonging farms, numbering the hosts")
        console.log("   * decentralizer remove x --> Removes the host number 'x' (refer to the previous list) from your contracts")
        console.log("   * decentralizer remove auto --> Removes all the duplicate hosts in a farm, leaving only one host per farm (the one holding more data)")
        console.log()
    }
}


function removeTest(argument2) {
    // Test function for removing x random hosts
    if (argument2 > 0) {
        // Open "farms.json" file
        var stream1 = fs.createReadStream('farms.json')
        var data= ''
        var chunk
        stream1.on('readable', function() { //Function just to read the whole file before proceeding
            while ((chunk=stream1.read()) != null) {
                data += chunk;}
        });
        stream1.on('end', function() {
            if (data != "") {
                var farmList = JSON.parse(data)
            } else {
                var farmList = []
            }
            // Picking up to argument2 random hosts
            var contractsToRemove = []
            var hostsCount = 0
            for (var i = 0; i < farmList.length; i++) {
                for (var j = 0; j < farmList[i].hosts.length; j++) {
                    if (hostsCount < argument2) { // Only add entry if we are not at the max amount of hosts to remove
                        var entry = {
                            ip: farmList[i].hosts[j].ip,
                            contract: farmList[i].hosts[j].contract
                        }
                        contractsToRemove.push(entry)
                        hostsCount++
                    }
                }
            }
            if (contractsToRemove.length > 15) {
                console.log("WARNING: Removing this amount of hosts in a single action can provoke data loss if you do not have the files locally anymore. It is recommended instead to remove a smaller (<15) number of hosts and allow file redundancy repair to 3x before proceeding with the next batch of hosts to remove. Proceed only at your own risk")
                console.log()
            } 
            console.log("This will remove " + contractsToRemove.length + " contracts with hosts. Proceed? (y/n)")

            // Input form
            var stdin = process.stdin;
            stdin.setRawMode( true );
            stdin.resume();
            stdin.setEncoding( 'utf8' );
            stdin.on( 'data', function( key ){
                if ( key === '\u0003' ) { // ctrl-c
                    process.exit();
                } else if (key === 'y') {
                    console.log()
                    var contractNum = 0
                    var attempt = 0
                    cancelContract(contractNum, contractsToRemove, attempt)
                } else if (key === 'n') {
                    console.log()
                    process.exit();
                }
                process.stdout.write( key );
            });
            
        })
        stream1.on('error', function() {
            console.log("Error: Decentralizer needs to scan the contracts in first place. Run 'decentralizer scan' first")
            console.log()
        })
    } else {
        // Error
        console.log("Syntax error in test second argument: indicate a number of hosts to remove (e.g. 'test 25')")
        console.log()
    }
}


function cancelContract(contractNum, contractsToRemove, attempt) {
    // Iterates on contractsToRemove canceling the contract
    process.stdout.write("\n(" + (contractNum+1) + "/" + contractsToRemove.length + ") Canceling contract with host: " + contractsToRemove[contractNum].ip + " ...")
    
    var contractID = contractsToRemove[contractNum].contract
    var command = "/renter/contract/cancel?id=" + contractID

    sia.connect('localhost:9980')
    .then((siad) => {siad.call({
            url: command,
            method: 'POST'
        })
        .then((API) => {
            process.stdout.write(" Done")
            attempt = 0
            contractNum++
            if (contractNum < contractsToRemove.length) {
                cancelContract(contractNum, contractsToRemove, attempt)
            } else {
                // End script
                console.log("")
                console.log("\nDONE")
                console.log("After removing all the desired hosts, it is recommended to run the 'scan' command again for confirmation")
                console.log("")
                // Finishes the process
                process.exit();
            }

        })
        .catch((err) => {
            attempt++
            process.stdout.write(" RETRYING")
            if (attempt > 3) {
                console.log("Error with command. This contract was not canceled: " + contractsToRemove[contractNum].ip)
            } else { // Retry up to 3 times
                cancelContract(contractNum, contractsToRemove, attempt)
            }
        })
    })
    .catch((err) => {
        attempt++
        process.stdout.write(" RETRYING")
        if (attempt > 3) {
            console.log("Error connecting to Sia. This contract was not canceled: " + contractsToRemove[contractNum].ip)
        } else { // Retry up to 3 times
            cancelContract(contractNum, contractsToRemove, attempt)
        }
    })

}

