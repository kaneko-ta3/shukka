/* ===================================================================
   送り状 余白書き換え の接続先
   ===================================================================

   入数マスタ（専用スプシの Apps Script、入数マスタ.gs）の
   ウェブアプリのURL（/exec で終わるもの）です。

   合言葉はありません。そのかわり入数マスタは一覧を返さず、
   送り状の品名欄で読んだ商品名を送ったときに、その入数だけを答えます。

   デプロイし直してURLが変わったときは、ここだけ直します。
*/

window.HINMEI_IRISU_API =
  "https://script.google.com/macros/s/AKfycbzWiLD0zEBKnzdDKpC5vywKO7FzxRnDCw5Sf78sQqbWnmUaYQaz6_ky90xeJRVHq4HR/exec";
