'use client';

/**
 * page.tsx
 *
 * Example data-driven page for the package-mode fixture. The page consumes
 * frontend hooks/components only and leaves persistence to Zero's SDK layer.
 */

import { Button, DataTable, useCollection } from '@zero/framework/react';
import { Plus } from '@zero/framework/icons';
import { customers as customersTable } from '../db/schema';

export default function HomePage() {
  const customers = useCollection('customers');

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            Review active customer records.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            void customers.insert({
              customer_id: crypto.randomUUID(),
              name: 'New customer',
              created_at: Date.now(),
            });
          }}
        >
          <Plus className="size-4" />
          Add Customer
        </Button>
      </header>

      <DataTable
        schema={customersTable.schema}
        data={customers.data}
        columns={['name', 'created_at']}
      />
    </main>
  );
}
