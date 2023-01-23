////////////////////////////////////////////////////////////////////////////////////////////////////////

import { join, dirname } from 'path';
import { Low, JSONFile } from 'lowdb';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(
    import.meta.url));

const file = join(__dirname, 'db.json')
const adapter = new JSONFile(file)
const db = new Low(adapter)

await db.read();

////////////////////////////////////////////////////////////////////////////////////////////////////////

import http from 'http';
import fs from 'fs';

const hostname = '127.0.0.1';
const port = 8080;
const before24h = new Date().getTime() / 1000 - 86400;

const showJs = fs.readFileSync('show.js');
const indexHtml = fs.readFileSync('index.html');

let searchStarted = false;

const server = http.createServer((req, res) => {
    if (req.url == '/market') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(JSON.stringify(db.data.searchedResult));
    } else if (req.url == '/time') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(db.data.searchedTime);
    } else if (req.url == '/crystal') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(JSON.stringify(db.data.searchCrystal));
    } else if (req.url == '/start') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
        if (isNearlyTime(db.data.searchedTime, now())) {
            res.end("Search Over.");
        } else {
            startSearch();
            res.end("Searching..." + db.data.searchedItemId);
        }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write(indexHtml);
        res.write("<script>");
        res.write("const searchedResult =" + JSON.stringify(db.data.searchedResult) + ";");
        res.write(showJs)
        res.write("</script>");
        res.end();
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});

////////////////////////////////////////////////////////////////////////////////////////////////////////

import got from 'got';
async function startSearch() {
    if (searchStarted) {
        return;
    }

    searchStarted = true;

    db.data = db.data || { searchedTime: null, searchedItemId: -1, searchedResult: [], searchingResult: [] };

    let leastRecentlyUpdatedItems = await got('https://universalis.app/api/v2/extra/stats/least-recently-updated?dcName=Alexander&entries=200').json();

    for (const index in leastRecentlyUpdatedItems.items) {
        await searchItem(leastRecentlyUpdatedItems.items[index].itemID);
    }

    db.data.searchedResult = db.data.searchingResult;
    db.data.searchingResult = [];
    db.data.searchedItemId = -1;
    db.data.searchedTime = now();

    await db.write();

    searchStarted = false;

    console.log("Loop Over");

    //await searchCrystal();
}

function now() {
    return formatDate(new Date(Date.now() + ((new Date().getTimezoneOffset() + (9 * 60)) * 60 * 1000)));
}

function formatDate(date) {
    if (typeof date == "string") {
        return date;
    }

    var yyyyy = date.getFullYear();
    var MM = ("00" + (date.getMonth() + 1)).slice(-2);
    var dd = ("00" + date.getDate()).slice(-2);
    var hh = ("00" + date.getHours()).slice(-2);
    var mm = ("00" + date.getMinutes()).slice(-2);

    var result = yyyyy + "-" + MM + "-" + dd + " " + hh + ":" + mm;
    return result;
}

function isNearlyTime(a, b) {
    const aHour = a.substring(11, 13);
    const bHour = b.substring(11, 13);
    return aHour == bHour;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////

async function searchItem(itemId) {
    if (Number(itemId) % 100 == 0) {
        console.log("Searching:" + itemId);
    }
    db.data.searchedItemId = itemId;

    const recentHistories = await got('https://universalis.app/api/v2/history/' + 'Alexander' + '/' + itemId, {
        searchParams: {
            entriesToReturn: 50
        }
    }).json();

    let salesIn24h = recentHistories.entries.filter(history => history.timestamp > before24h);

    let onlyHq = false;
    const salesHq = salesIn24h.filter(sale => sale.hq == true);
    const salesNq = salesIn24h.filter(sale => sale.hq == false);
    if (salesHq.length / salesNq.length > 2) {
        onlyHq = true;
        salesIn24h = salesHq;
    }

    let soldAmount = 0;
    let soldQuantity = 0;
    salesIn24h.forEach(sales => {
        soldQuantity = soldQuantity + sales.quantity;
        soldAmount = soldAmount + sales.quantity * sales.pricePerUnit;
    });
    let avgSoldPrice = Math.round(soldAmount / soldQuantity);
    let soldTimes = salesIn24h.length;
    if (soldTimes == 50) {
        soldTimes = soldTimes + "以上";
    }

    if (salesIn24h.length >= 10 || avgSoldPrice > 100000) {
        const jpName = await searchJpName(itemId);
        const bordInfo = await searchCheapestPrice(itemId, onlyHq);

        db.data.searchingResult.push({
            itemId: itemId,
            name: jpName,
            avgSoldPrice: avgSoldPrice,
            soldTimes: soldTimes,
            soldQuantity: soldQuantity,
            soldAmount: soldAmount,
            CheapestPrice: {
                worldName: bordInfo.worldName,
                pricePerUnit: bordInfo.pricePerUnit,
                quantity: bordInfo.quantity
            }
        });
    }

    await db.write();
}

async function searchJpName(itemId) {
    const itemResponse = await got('https://xivapi.com/item/' + itemId).json();
    return itemResponse.Name_ja;
};

async function searchCheapestPrice(itemId, onlyHq) {
    const itemResponse = await got('https://universalis.app/api/v2/' + 'Gaia' + '/' + itemId, {
        searchParams: {
            listings: onlyHq ? 999 : 1,
            entries: 0
        }
    }).json();
    const bordInfo = onlyHq ? itemResponse.listings.filter(list => list.hq == true)[0] : itemResponse.listings[0];
    return bordInfo != undefined ? bordInfo : { worldName: "", pricePerUnit: -1, quantity: -1 };
}

/////////////////////////////////////////////////////////////////////////
///////////////////// クリスタル転売用 ///////////////////////////////////
/////////////////////////////////////////////////////////////////////////
async function searchCrystal() {
    db.data.searchCrystal = {};

    let searchItems = [];
    searchItems[2] = "2 ファイアシャード";
    searchItems[3] = "3 アイスシャード";
    searchItems[4] = "4 ウィンドシャード";
    searchItems[5] = "5 アースシャード";
    searchItems[6] = "6 ライトニングシャード";
    searchItems[7] = "7 ウォーターシャード";
    searchItems[8] = "8 ファイアクリスタル";
    searchItems[9] = "9 アイスクリスタル";
    searchItems[10] = "10 ウィンドクリスタル";
    searchItems[11] = "11 アースクリスタル";
    searchItems[12] = "12 ライトニングクリスタル";
    searchItems[13] = "13 ウォータークリスタル";
    searchItems[14] = "14 ファイアクラスター";
    searchItems[15] = "15 アイスクラスター";
    searchItems[16] = "16 ウィンドクラスター";
    searchItems[17] = "17 アースクラスター";
    searchItems[18] = "18 ライトニングクラスター";
    searchItems[19] = "19 ウォータークラスター";

    for (const key in searchItems) {
        db.data.searchCrystal[key] = await searchPricePerWorld(key);
    }
    await db.write();
}

async function searchPricePerWorld(itemId) {
    // 平均単価計算時使用するアイテム数
    let limitCount = itemId < 20 ? 9999 : 3;

    let itemResponse = await got('https://universalis.app/api/v2/' + 'Gaia' + '/' + itemId, {
        searchParams: {
            entries: 0,
            hq: "nq"
        }
    }).json();

    let results = {
        worlds: [],
        pricePerWorld: {}
    };

    // 単価昇順で並び替え
    itemResponse.listings.sort(function (a, b) {
        return a.pricePerUnit - b.pricePerUnit;
    });

    // ワールド別に最安 9999 個の単価を集計
    itemResponse.listings.forEach(listing => {
        if (results.pricePerWorld[listing.worldID] == null) {
            results.worlds.push(listing.worldID);
            results.pricePerWorld[listing.worldID] = {
                "worldName": listing.worldName,
                "pricePerUnit": listing.pricePerUnit,
                "quantity": listing.quantity,
                "sum": listing.pricePerUnit * listing.quantity,
            }
        } else {
            if (results.pricePerWorld[listing.worldID].quantity < limitCount) {
                results.pricePerWorld[listing.worldID].quantity = results.pricePerWorld[listing.worldID].quantity + listing.quantity;
                results.pricePerWorld[listing.worldID].sum = results.pricePerWorld[listing.worldID].sum + listing.pricePerUnit * listing.quantity;
                results.pricePerWorld[listing.worldID].pricePerUnit = results.pricePerWorld[listing.worldID].sum / results.pricePerWorld[listing.worldID].quantity;
            }
        }
    });

    return results;
}