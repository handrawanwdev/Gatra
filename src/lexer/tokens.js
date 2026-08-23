'use strict';

const TokenType = {
  // Literals
  NUMBER:     'NUMBER',
  STRING:     'STRING',
  BOOL:       'BOOL',
  FSTRING:    'FSTRING',    // f"..." interpolated string

  // Identifiers / keywords / types
  IDENTIFIER: 'IDENTIFIER',
  KEYWORD:    'KEYWORD',
  TYPE:       'TYPE',

  // Punctuation
  COLON:      'COLON',      // :
  EQUALS:     'EQUALS',     // =
  EQEQ:       'EQEQ',       // ==
  NEQ:        'NEQ',        // !=
  BANG:       'BANG',       // !
  LPAREN:     'LPAREN',     // (
  RPAREN:     'RPAREN',     // )
  LBRACE:     'LBRACE',     // {
  RBRACE:     'RBRACE',     // }
  COMMA:      'COMMA',      // ,
  DOT:        'DOT',        // .
  LBRACKET:   'LBRACKET',   // [
  RBRACKET:   'RBRACKET',   // ]
  AMPERSAND:  'AMPERSAND',  // &
  STAR:       'STAR',       // *
  QUESTION:   'QUESTION',   // ?

  // Arithmetic operators
  PLUS:       'PLUS',       // +
  MINUS:      'MINUS',      // -
  SLASH:      'SLASH',      // /
  DOTDOT:     'DOTDOT',     // ..
  ELLIPSIS:   'ELLIPSIS',  // ...
  ARROW:      'ARROW',     // ->
  AND:        'AND',        // &&
  OR:         'OR',         // ||

  // Comparison operators
  GT:         'GT',         // >
  LT:         'LT',         // <
  GTE:        'GTE',        // >=
  LTE:        'LTE',        // <=

  EOF:        'EOF',
};

module.exports = { TokenType };
