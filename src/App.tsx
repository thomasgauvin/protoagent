import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { OptionValues } from 'commander';

export const App = (options: OptionValues) => {
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCounter((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">Hello from Ink CLI!</Text>
      <Text>Counter: {counter}</Text>
      <Text>{JSON.stringify(options)}</Text>
    </Box>
  );
};