import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { StorageDriveSettingsPanel } from './storage-drive-settings-panel';
import type { StorageDriveRow } from './storage-management-types';

const drive: StorageDriveRow = { id: 'synthetic-drive', name: 'Synthetic drive', max_size_bytes: 1024,
  max_file_size_bytes: 100, public: 0, allowed_mime_types: '*', owner_id: null };
function Fixture() {
  const [result, setResult] = useState('No mutation');
  const [reject, setReject] = useState(false);
  return <><StorageDriveSettingsPanel drive={drive} onSave={changes => {
    if (reject) { setResult('Server rejected'); throw new Error('Synthetic rejected settings'); }
    setResult(JSON.stringify(changes));
  }} /><button onClick={() => setReject(true)}>Reject next save</button>
    <output aria-label="Save result">{result}</output></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
