//
//  clawchatTests.swift
//  clawchatTests
//
//  Created by Changer Ding on 2026/4/12.
//

import Testing
@testable import clawchat

struct clawchatTests {

    @Test func messageContentMetaAcceptsNullValues() throws {
        let payload = """
        {
          "id": "m1",
          "conversation_id": "c1",
          "mqtt_topic": "c1",
          "sender_id": "u1",
          "sender_type": "user",
          "from": { "type": "user", "id": "u1" },
          "to": { "type": "group", "id": "g1" },
          "content": {
            "type": "image",
            "meta": {
              "asset": {
                "external_url": null
              }
            }
          }
        }
        """.data(using: .utf8)!

        let message = try JSONDecoder().decode(Message.self, from: payload)
        let asset = message.content.meta?["asset"]?.dictionaryValue

        #expect(asset?["external_url"]?.value is NSNull)
    }

    @Test func anyCodableEncodesNullValuesAsJsonNull() throws {
        let object: [String: AnyCodable] = [
            "external_url": AnyCodable(NSNull())
        ]
        let data = try JSONEncoder().encode(object)
        let decoded = try JSONDecoder().decode([String: AnyCodable].self, from: data)

        #expect(decoded["external_url"]?.value is NSNull)
    }

}
