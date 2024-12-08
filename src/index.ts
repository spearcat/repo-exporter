import 'dotenv/config';
import { persister } from './persister.js';
import ZipStream, { FileDataInput } from "zip-stream";

// await persister.restoreDatabase(`${process.env.BACKUP_HANDLE}.repo.zip`);

import { XRPC, CredentialManager } from '@atcute/client';
import { writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import type { Stream, TransformOptions } from "readable-stream";
import { Readable, type Stream as NodeStream } from "node:stream";
import type { ZipArchiveEntry } from 'compress-commons';
import { XRPCEx } from './xrpc-ex.js';
import toBuffer from 'typedarray-to-buffer';
import { At } from '@atcute/client/lexicons';

const manager = new CredentialManager({ service: 'https://bsky.social' });
const rpc = new XRPCEx({ handler: manager });

await manager.login({
    identifier: process.env.BSKY_USERNAME!,
    password: process.env.BSKY_PASSWORD!
});

const { data: { did } } = await rpc.get('com.atproto.identity.resolveHandle', {
	params: {
		handle: process.env.BACKUP_HANDLE!,
	},
});

/**
 * DID document
 */
interface DidDocument {
	id: string;
	alsoKnownAs?: string[];
	verificationMethod?: Array<{
		id: string;
		type: string;
		controller: string;
		publicKeyMultibase?: string;
	}>;
	service?: Array<{
		id: string;
		type: string;
		serviceEndpoint: string | Record<string, unknown>;
	}>;
}

async function getPds(did: At.DID) {
    /**
     * Retrieves AT Protocol PDS endpoint from the DID document, if available
     * @param doc DID document
     * @returns The PDS endpoint, if available
     */
    function getPdsEndpoint(doc: DidDocument): string | undefined {
        return getServiceEndpoint(doc, '#atproto_pds', 'AtprotoPersonalDataServer');
    }

    /**
     * Retrieve a service endpoint from the DID document, if available
     * @param doc DID document
     * @param serviceId Service ID
     * @param serviceType Service type
     * @returns The requested service endpoint, if available
     */
    function getServiceEndpoint(
        doc: DidDocument,
        serviceId: string,
        serviceType: string,
    ): string | undefined {
        const did = doc.id;

        const didServiceId = did + serviceId;
        const found = doc.service?.find((service) => service.id === serviceId || service.id === didServiceId);

        if (!found || found.type !== serviceType || typeof found.serviceEndpoint !== 'string') {
            return undefined;
        }

        return validateUrl(found.serviceEndpoint);
    }

    function validateUrl(urlStr: string): string | undefined {
        let url;
        try {
            url = new URL(urlStr);
        } catch {
            return undefined;
        }

        const proto = url.protocol;

        if (url.hostname && (proto === 'http:' || proto === 'https:')) {
            return urlStr;
        }
    }

    async function getDidDocument(did: At.DID): Promise<DidDocument> {
        const colon_index = did.indexOf(':', 4);
    
        const type = did.slice(4, colon_index);
        const ident = did.slice(colon_index + 1);
    
        // 2. retrieve their DID documents
        let doc: DidDocument;
    
        if (type === 'plc') {
            const response = await fetch(`https://plc.directory/${did}`);
    
            if (response.status === 404) {
                throw new Error(`did not found in directory`);
            } else if (!response.ok) {
                throw new Error(`directory is unreachable`);
            }
    
            const json = await response.json();
    
            doc = json as DidDocument;
        } else if (type === 'web') {
            const DID_WEB_RE = /^([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*(?:\.[a-zA-Z]{2,}))$/;
            
            if (!DID_WEB_RE.test(ident)) {
                throw new Error(`invalid identifier`);
            }
    
            const response = await fetch(`https://${ident}/.well-known/did.json`);
    
            if (!response.ok) {
                throw new Error(`did document is unreachable`);
            }
    
            const json = await response.json();
    
            doc = json as DidDocument;
        } else {
            throw new Error(`unsupported did method`);
        }
    
        return doc;
    }

    const didDocument = await getDidDocument(did);
    return getPdsEndpoint(didDocument);
}

console.log(did);
const pds = await getPds(did);
console.log(pds);

const unauthedManager = new CredentialManager({ service: pds! });
const unauthedRpc = new XRPCEx({ handler: unauthedManager });

const response = await fetch(`${pds}/xrpc/com.atproto.sync.getRepo?did=${did}`);
if (!response.ok) {
    throw new Error(await response.text());
}

const archive = new ZipStream({
    level: 9,
}); // OR new ZipStream(options)

const repo = createWriteStream(`${process.env.BACKUP_HANDLE}.repo.zip`);

archive.pipe(repo);

const endPromise = new Promise<void>((resolve, reject) => {
    repo.on('finish', () => {
        resolve();
    });

    archive.on("error", function (err) {
        reject(err);
        throw err;
    });
});

function entry(
    archive: ZipStream, 
    source?: Buffer | Stream | NodeStream | string | null,
    data?: FileDataInput
): Promise<ZipArchiveEntry> {
    return new Promise((resolve, reject) => {
        archive.entry(source, data, (err, entry) => {
            if (err) reject(err);
            else resolve(entry!);
        });
    })
}

console.log('adding repo.car');
await entry(archive, Readable.fromWeb(response.body! as any), { name: 'repo.car' });

console.log('listing blobs');
const { cids: blobCids } = await unauthedRpc.paginatedListBlobs({ did });

for (const cid of blobCids) {
    console.log(`adding cid ${cid}`);

    const { data: blob } = await unauthedRpc.get('com.atproto.sync.getBlob', {
        params: {
            did,
            cid
        }
    });

    await entry(archive, toBuffer(blob), { name: `${cid}.blob` });
}

archive.finish();

await endPromise;

console.log('persisting repo');
await persister.persistDatabase(`${process.env.BACKUP_HANDLE}.repo.zip`);
console.log('persisted repo');

process.exit(0);