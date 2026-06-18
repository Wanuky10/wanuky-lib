/**
 * LRU Cache berbasis Map dengan eviction otomatis.
 * Map di JS menjaga insertion order — ini yang memungkinkan LRU tanpa struktur tambahan.
 */
export class LRUCache {
  #cache = new Map();
  #maxSize;

  /** @param {number} maxSize - Maksimum entri sebelum evict. Default: 200 */
  constructor(maxSize = 200) {
    if (maxSize < 1) throw new RangeError('LRUCache: maxSize harus >= 1');
    this.#maxSize = maxSize;
  }

  /**
   * Ambil nilai. Otomatis promote ke "most recently used".
   * @returns {unknown | undefined}
   */
  get(key) {
    if (!this.#cache.has(key)) return undefined;
    const value = this.#cache.get(key);
    // Re-insert ke akhir = tandai sebagai most recently used
    this.#cache.delete(key);
    this.#cache.set(key, value);
    return value;
  }

  /**
   * Set nilai. Jika cache penuh, hapus entri paling lama tidak diakses.
   */
  set(key, value) {
    if (this.#cache.has(key)) {
      this.#cache.delete(key);
    } else if (this.#cache.size >= this.#maxSize) {
      // .keys().next().value = first key = least recently used
      this.#cache.delete(this.#cache.keys().next().value);
    }
    this.#cache.set(key, value);
  }

  has(key)    { return this.#cache.has(key); }
  delete(key) { return this.#cache.delete(key); }
  clear()     { this.#cache.clear(); }

  get size()    { return this.#cache.size; }
  get maxSize() { return this.#maxSize; }
}
