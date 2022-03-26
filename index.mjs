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

const server = http.createServer((req, res) => {
    if (req.url == '/market') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end(JSON.stringify(db.data.searchedResult));
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

db.data = db.data || { searchedItemId: -1, searchedResult: [], searchingResult: [] };

let marketableItemsId = await got('https://universalis.app/api/marketable').json();

for (const index in marketableItemsId) {
    if (marketableItemsId[index] == db.data.searchedItemId && index != marketableItemsId.length) {
        marketableItemsId = marketableItemsId.slice(index);
        break;
    }
}

for (const index in marketableItemsId) {
    await searchItem(marketableItemsId[index]);
}

db.data.searchedResult = db.data.searchingResult;
db.data.searchingResult = [];
db.data.searchedItemId = -1;

await db.write();
console.log("Loop Over");

////////////////////////////////////////////////////////////////////////////////////////////////////////

async function searchItem(itemId) {
    db.data.searchedItemId = itemId;

    const recentHistories = await got('https://universalis.app/api/v2/history/' + 'Alexander' + '/' + itemId, {
        searchParams: {
            entriesToReturn: 50
        }
    }).json();

    let salesIn24h = recentHistories.entries.filter(history => history.timestamp > before24h);

    if (salesIn24h.length >= 10) {
        let onlyHq = false;
        const salesHq = salesIn24h.filter(sale => sale.hq == true);
        const salesNq = salesIn24h.filter(sale => sale.hq == false);
        if (salesHq.length / salesNq.length > 2) {
            onlyHq = true;
            salesIn24h = salesHq;
        }

        const jpName = await searchJpName(itemId);
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