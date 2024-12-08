import fs from 'node:fs/promises';
import osPath from 'node:path';

abstract class DatabasePersister {
    abstract restoreDatabase(path: string): Promise<void>;
    abstract persistDatabase(path: string): Promise<void>;
}

let persister: DatabasePersister;
if (process.env.USE_ACTIONS) {
    const { context, getOctokit } = await import('@actions/github');

    const octokit = getOctokit(process.env.GITHUB_TOKEN!);

    persister = new class ReleasesDatabasePersister extends DatabasePersister {
        async restoreDatabase(path: string): Promise<void> {
            let getReleaseResponse;
            try {
                getReleaseResponse = await octokit.rest.repos.listReleases({
                    per_page: 1,
                    // page: 1,
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                });
            } catch (err) {
                console.error(`getReleaseResponse ${err}`);
                return;
            }

            if (getReleaseResponse.status != 200) {
                console.log(`getReleaseResponse status ${getReleaseResponse.status}`);
                return;
            }

            const downloadUrl = getReleaseResponse.data[0].assets.find(e => e.name == osPath.basename(path))?.browser_download_url
            if (!downloadUrl) {
                console.log(`no downloadUrl for ${getReleaseResponse.data[0].name}`);
                return;
            }

            const buf = await fetch(downloadUrl).then(e => e.ok ? e.arrayBuffer() : undefined);
            if (buf) {
                await fs.writeFile(path, Buffer.from(buf));
                console.log(`downloaded database from ${getReleaseResponse.data[0].name}}`);
            } else {
                console.log('not ok');
            }
        }

        async persistDatabase(path: string): Promise<void> {
            const date = new Date();

            const createReleaseResponse = await octokit.rest.repos.createRelease({
                owner: context.repo.owner,
                repo: context.repo.repo,
                tag_name: `database-${
                    process.env.BACKUP_HANDLE?.replace(/\./g, '-')
                }-${
                    date.toISOString().replace(/:/g, '-')
                }`,
                name: `${process.env.BACKUP_HANDLE ?? path} snapshot (${date.toUTCString()})`,
                draft: false,
                prerelease: true
            });

            await octokit.request<
                'POST {origin}/repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}'
            >({
                method: "POST",
                url: createReleaseResponse.data.upload_url,
                headers: {
                    "content-type": "application/zip",
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                data: await fs.readFile(path),
                name: osPath.basename(path),
                label: osPath.basename(path),
            });
        }
    }
} else {
    persister = new class DummyDatabasePersister extends DatabasePersister {
        async restoreDatabase(path: string): Promise<void> {
        }
        async persistDatabase(path: string): Promise<void> {
        }
    }
}

export { persister };