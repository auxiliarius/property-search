#!/usr/bin/env node

const csvToJSON = require( 'csv-parse/lib/sync' );
const { parse: jsonToCSV } = require( 'json2csv' );
const fetch = require( 'node-fetch' );
const fs = require( 'fs' );

// 1) Make sure a valid file is passed in.
const fileName = process.argv[2];
if ( fileName === null || ! fileName.endsWith( '.csv' ) || ! fs.existsSync( fileName ) ) {
	console.error( 'Please provide a valid CSV file to parse. Example usage: ./index.js path/to/csvfile.csv' );
	process.exit( 1 );
}

// 2) Run the script.
console.log( 'Running property-search. This may take a few minutes while addresses are looked up.' );

let counter = 0;
let unlisted_counter = 0;
(async () => {
	try {
		// A) Convert CSV file to an array of objects.
		const fileData = fs.readFileSync( fileName, { encoding:'utf8', flag:'r' } );
		const csvRows = csvToJSON( fileData, { headers: false } );

		// B) Loop over array and insert the address after looking it up.
		let csvData = [];
		for ( const row of csvRows ) {
			counter++

			// NOTE: This bit is somewhat fragile. The second column in the CSV must be the lookup ID.
			const lookupID = row[1];

			// Could break a few rows into multiple threads at once for quicker processing,
			// but it sort of self-rate-limits itself which is likely good to prevent the website from getting mad :).
			const address = await findAddress( lookupID );
			if ( address === 'Unlisted Address' ) {
				unlisted_counter++;

				const successfulLookups = counter - unlisted_counter;
				const percentSuccess = ( 100 * successfulLookups ) / counter;
				if ( counter > 20 && percentSuccess < 75 ) {
					console.error( 'Too many failed lookups, there may be something wrong with the API calls.' );
					process.exit( 1 );
				}
			}

			// Bit hacky, but easy way to put the address column at the front.
			csvData.push( { ...[ address ].concat( Object.values( row ) ) } );

			if ( counter % 100 == 0 ) {
				console.log( `Processed: ${counter}/${csvRows.length}. Unlisted count: ${unlisted_counter}` );
			}
		}

		// C) Create new CSV file with the added address data.
		const result = jsonToCSV( csvData, { header: false } );
		fs.writeFileSync( fileName.replace( '.csv', '-new.csv' ), result );
		console.log( `Processing complete. New file created: ${fileName.replace( '.csv', '-new.csv' )}` );
	} catch ( error ) {
		console.error( 'An error occured during script processing. Error: ' + error.message );
		process.exit( 1 );
	}
})();

async function findAddress( lookupID ) {
	// NOTE: This bit is somewhat fragile as well. The site is a bit picky about what headers must be present, and could change in the future.
	// Also not sure if the "__EVENTVALIDATION" is a nonce that requires updating within some timeframe.
	const response = await fetch( 'https://agis.wingis.org/maps/PropertySearch.aspx', {
		'headers': {
			'authority': 'agis.wingis.org',
			'pragma': 'no-cache',
			'cache-control': 'no-cache',
			'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36',
			'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
			'accept': '*/*',
			'origin': 'https://agis.wingis.org',
			'referer': 'https://agis.wingis.org/maps/PropertySearch.aspx',
		},
		'body': `txtSearch=${lookupID}&sm1=upSearch%7CbtnSearch&__VIEWSTATE=%2FwEPDwUJLTMyNzkzMTE0D2QWAgIDD2QWAgIFD2QWAmYPZBYCAgcPDxYEHgRUZXh0BRhObyBQYXJjZWwgRGF0YSBBdmFpbGFibGUeB1Zpc2libGVoZGRkNn7OlMLjgMAhB5STrMzLDIhD0wMHb1BWHsglv6MCGvk%3D&__EVENTVALIDATION=%2FwEdAAN73fmY3iujp1L%2Bi%2FJz5KRpJy3pjLgyNr58jsdLjyzCdY7U3Vc0WZ%2BwxclqyPFfzmOu7oiK%2Bu5WJqrVVV3m1RweabFZAIXlf3TJNEh2crxN%2Fw%3D%3D&__ASYNCPOST=true&btnSearch=Search`,
		'method': 'POST',
	} );

	const body = await response.text();
	if ( -1 === body.indexOf( '<table>' ) || -1 === body.indexOf( '<h5>' ) ) {
		return 'Unlisted Address';
	}

	// NOTE: Also fragile, as they could change the HTML makeup of the site.
	const addressTable = body.substring( body.indexOf( '<table>' ), body.indexOf( '</table>' ) + 8 );
	return addressTable.substring( addressTable.indexOf( '<h5>' ) + 4, addressTable.indexOf( '</h5>' ) );
}
