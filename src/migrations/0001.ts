import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
    await db.schema.createTable('entries')
        .addColumn('entry_id', 'varchar(255)', (cb) => cb.primaryKey().notNull())
        .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('entries').execute();
}