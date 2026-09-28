// Node fetch requires duplex for streamed request bodies.
interface RequestInit {
  duplex?: 'half';
}
