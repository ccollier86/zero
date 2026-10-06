/** Public-package fixture route; synthetic writes only, with no caller-selected scope. */
import { createServerRoute } from '@zero/framework/server';

export default createServerRoute({ name: 'proof.automation-torrent', prefix: '/proof/orders' })
  .post('/:id', ({ zero, params }) => {
    zero.unsafe.db.insert('orders', { id: params.id, title: 'Captured title' });
    return { accepted: true };
  })
  .patch('/:id', ({ zero, params }) => {
    zero.unsafe.db.update('orders', params.id, { title: 'Later title' });
    return { accepted: true };
  });
