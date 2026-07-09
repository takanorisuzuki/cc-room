# cc-room

> ホワイトボードのある会議室に、各自が自分の Claude を連れて入る。

各エンジニアが自分の Claude Code で自分のペースで作業しながら、**公開中**（Private OFF）ならサマリー・成果物が自動でホワイトボード（Primary ルーム）に出る。手元の作業は `/private on` で誰にも見えない。`@name` で人間同士も直接やりとりできる。

```
既存ツール = 「1つのAIを複数人で操作する」 or 「複数のAIを協調させる」
cc-room    = 「各自のAIが同じ会議室にいて、ホワイトボードを通じて連携する」
```

---

## このプロジェクトについて

個人的に作っていた実験プロジェクトです。

- **2026年6月上旬**に「各自の Claude Code を同じ会議室で連携させる」というアイデアを構想・実装開始
- **2026年6月〜7月初旬**にかけて、mDNS + WebSocket による LAN 内連携、`/private` による公開/手元の切替、チームメモリ（v0.3）まで一通り動く状態に到達

その後、Claude Code 本体にマルチプレイヤー機能が公式リリースされ、ほぼ同じコンセプトが本家で実現されました。個人で作っていたものが実際に動くところまで来ていたので、記録と参考のために非公式プロジェクトとして公開します。今後は本家の機能が使われていくはずで、これはアーカイブ的な位置づけです。

---

## インストール

```bash
npx setup-cc-room
```

これだけ。Claude Code を開いて `/room open my-room` で始められる。

---

## 使い方

```
/room open auth-feature     # 会議室を作る（PIN が発行される。Primary になる）
/room join auth-feature <PIN>  # チームメイトが入室（2部屋目は Watch = Read Only）
/room switch other-room     # Primary（執筆するルーム）を切替
/room                       # ホワイトボードを見る
/room remember "JWT方式: パターンB、TTL 3日"   # 付箋を貼る

/private on                 # 手元モード（執筆は pending に蓄積、誰にも見えない）
/private off                # 公開へ戻る（pending があれば毎回 share/drop を選択）

/show "TTLは3日にすべき"    # Primary へメッセージ投稿
/show skill deep-research   # スキルを部屋に共有
/show claude-md             # CLAUDE.md を共有

/room leave                 # 退室
```

入室するとホワイトボードの内容（サマリー・成果物・メッセージ）が自動で同期される。

- **Primary** — 執筆するルーム（1つだけ）。サマリー・成果物・Dream はここへ流れる
- **Watch** — 見るだけ（Read Only）。2部屋目以降の join はデフォルト Watch
- **公開中**（Private OFF）— サマリー・成果物が Primary へ自動配信される状態
- **`/private on`** — 手元モード。戻すときは毎回 share（送る）/ drop（捨てる）を選ぶ（自動 flush なし）

### @メンション（人間同士のやりとり）

Claude Code の入力欄で `@` から始めると、**人間に直接**届く（Claude への指示ではない）。

| 構文 | 届く先 |
|---|---|
| `@akira JWT終わったよ` | akira だけ |
| `@here ランチ行く人いる？` | 公開中（Primary かつ Private OFF）のメンバー全員 |
| `@all デプロイ完了しました` | 部屋の全員（Private ON/OFF 問わず） |

- 送信者が公開中（Private OFF）なら作業サマリー付きで届く（Private ON / Watch ではサマリーなし、本文のみ）
- 受信側はステータスラインに `📬 N件` が表示される
- 次に Claude に話しかけると、未読メンションがプロンプト先頭にバナーとして差し込まれ、Claude も把握する
- `@dataclass` など部屋にいない名前は通常入力として Claude に渡る（誤検出しない）

---

## 何が共有されるか

| データ | 公開中（Private OFF） | Private ON |
|---|---|---|
| 会話サマリー（技術作業） | リアルタイム自動（Primary のみ） | pending に蓄積（非公開） |
| 生成ファイル (Write/Edit) | リアルタイム自動（Primary のみ） | pending に蓄積（非公開） |
| `/show "msg"` のメッセージ | 即時 | 確認後に投稿 |
| `@メンション` 本文 | 宛先のみ（送信者サマリー付き） | 宛先のみ（サマリーなし） |
| `/room remember` のメモ | 即時 | 即時 |
| 会話の生テキスト | 常に非公開 | 常に非公開 |
| プライベートツール結果 | 自動除外 | 非公開 |

配信条件は「Primary ルーム AND Private OFF AND プライバシーフィルタ通過」。Watch ルームへは自動執筆しない。

---

## 仕組み

```
Alice の Claude Code
  └─ session jsonl を監視 → 差分サマリ生成 → WebSocket (LAN) →
                                                Bob の ~/.cc-room/ に保存
                                                └─ MCP tool で取得 → Bob の Claude Code が文脈を持った状態で回答
```

- **LAN 内のみ**: mDNS + WebSocket。外部サーバーなし、クラウド送信なし
- **Claude Code 無改造**: Hooks / MCP Server / Slash Commands の公式拡張ポイントのみ使用
- **各自のAPIキー**: Anthropic API は各自のキーで各自が呼ぶ
- **部屋の認証**: 名前 + 6桁 PIN → HKDF で HMAC キー導出
- **中間サマリー**: 公開中（Private OFF）が 30 分以上続くと自動でサマリーを共有

### デモシナリオ

```
akira: /room open auth-feature
yuki:  /room join auth-feature <PIN>
akira: 「JWT設計書を作って」→ design.md 生成（公開中なので自動配信）
yuki:  design.md が届く → room_context() でレビュー
yuki:  /show "TTL 3日は長いかも"
akira: "@yuki 認証テストどこまで進んだ？"
yuki:  次のターンでバナー表示 → Claude も把握
```

---

## 部屋のライフサイクル

- **デーモン停止 (Ctrl+C)**: 全部屋から退出してプロセス終了。ゴミが残らない
- **Idle 自動クリーンアップ**: 全ピア切断後 30 秒で部屋を自動削除（セーフティネット）
- **作成直後の部屋**: まだ誰も接続していないため idle 対象外

---

## 要件

- Node.js 20+
- Claude Code
- 同一 LAN（WiFi / 有線）内のチームメイト

### リモートワークで使いたい場合

- **Tailscale（推奨）**: `tailscale up` するだけで仮想的に同一 LAN になる
- **IP 直指定**: `/room join` の発見結果に表示される IP で直接接続も可能

---

## 開発

```bash
pnpm install          # 依存インストール
pnpm build            # TypeScript コンパイル
pnpm dev              # watch モードでビルド
pnpm test             # テスト実行
```

---

## License

MIT
