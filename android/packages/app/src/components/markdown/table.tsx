import * as React from "react";
import { Text, View } from "react-native";
import { createMarkdownTableComponents, fitTableColumns } from "./table-layout";

export const { Table: MarkdownTable, Cell: MarkdownTableCell } =
  createMarkdownTableComponents(React, View, Text, fitTableColumns);
