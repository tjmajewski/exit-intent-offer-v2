// Manual migration script to add separate discount code settings for Manual and AI modes
const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

async function migrate() {
  try {
    console.log('Starting migration...');

    // Execute raw SQL to add new columns
    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN manualDiscountCodeMode TEXT NOT NULL DEFAULT 'unique';
    `);
    console.log('✓ Added manualDiscountCodeMode column');

    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN manualGenericDiscountCode TEXT;
    `);
    console.log('✓ Added manualGenericDiscountCode column');

    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN manualDiscountCodePrefix TEXT DEFAULT 'EXIT';
    `);
    console.log('✓ Added manualDiscountCodePrefix column');

    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN aiDiscountCodeMode TEXT NOT NULL DEFAULT 'unique';
    `);
    console.log('✓ Added aiDiscountCodeMode column');

    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN aiGenericDiscountCode TEXT;
    `);
    console.log('✓ Added aiGenericDiscountCode column');

    await db.$executeRawUnsafe(`
      ALTER TABLE Shop ADD COLUMN aiDiscountCodePrefix TEXT DEFAULT 'EXIT';
    `);
    console.log('✓ Added aiDiscountCodePrefix column');

    // Migrate existing data
    await db.$executeRawUnsafe(`
      UPDATE Shop SET
        manualDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
        manualGenericDiscountCode = genericDiscountCode,
        manualDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT'),
        aiDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
        aiGenericDiscountCode = genericDiscountCode,
        aiDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT')
      WHERE 1=1;
    `);
    console.log('✓ Migrated existing data to new columns');

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    if (error.message.includes('duplicate column name')) {
      console.log('⚠️  Columns already exist, skipping creation');

      // Just try the data migration
      try {
        await db.$executeRawUnsafe(`
          UPDATE Shop SET
            manualDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
            manualGenericDiscountCode = genericDiscountCode,
            manualDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT'),
            aiDiscountCodeMode = COALESCE(discountCodeMode, 'unique'),
            aiGenericDiscountCode = genericDiscountCode,
            aiDiscountCodePrefix = COALESCE(discountCodePrefix, 'EXIT')
          WHERE 1=1;
        `);
        console.log('✓ Migrated existing data to new columns');
        console.log('\n✅ Migration completed successfully!');
      } catch (dataError) {
        console.error('Error migrating data:', dataError.message);
      }
    } else {
      console.error('Migration error:', error);
      throw error;
    }
  } finally {
    await db.$disconnect();
  }
}

migrate();
